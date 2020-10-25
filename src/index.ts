import { createConnections } from "typeorm";
import { User as syzojUser } from "./model-syzoj/user";
import { BinaryCompileStatus, UserBomb } from "./model-bomblab/userbomb";
import { Submission } from "./model-bomblab/submission";
import "reflect-metadata";

import { BomblabGlobalConfig } from "./GlobalConfig";
import { promises as fsPromises, readFileSync } from "fs";

import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import request from "request";
import { promisify } from "util";
import { URLSearchParams } from "url";
import path from "path";
import { BombLabBase, BombSubmission, ParsedBombSubmission, BombJudgeResult } from "./lab";

const promiseGet = promisify(request.get);
const promisePost = promisify(request.post);

global.bomblabConfig = JSON.parse(readFileSync('./configs/global.json').toString()) as BomblabGlobalConfig;

async function main() {
    let labs: { [name: string]: BombLabBase } = {};

    {
        const labnames = await fsPromises.readdir(__dirname + '/labs');
        for (let labname of labnames.filter(name => path.extname(name) === '.js')) {
            labname = path.basename(labname, '.js');
            let lab = require(`./labs/${labname}`).default as { new(config: any): BombLabBase };
            let labconfig = JSON.parse((await fsPromises.readFile(`./configs/${labname}.json`)).toString());
            labs[labname] = new lab(labconfig);
        }
    }

    const [bomblab, syzoj] = await createConnections([{
        name: "bomblab",
        type: "sqlite",
        database: './bomblab.db',
        synchronize: true,
        entities: [__dirname + "/model-bomblab/*{.js,.ts}"],
        logging: true
    },
    {
        name: "syzoj",
        type: "mariadb",
        cache: false,
        synchronize: false,
        host: global.bomblabConfig.syzoj_db_host,
        port: global.bomblabConfig.syzoj_db_port,
        username: global.bomblabConfig.syzoj_db_user,
        password: global.bomblabConfig.syzoj_db_password,
        database: global.bomblabConfig.syzoj_db_database,
        entities: [__dirname + "/model-syzoj/*{.js,.ts}"],
        logging: true
    }]);

    let bomblabUserBombRespository = bomblab.getRepository(UserBomb);
    let bomblabSubmissionRespository = bomblab.getRepository(Submission);

    const app = express()
    app.use(cookieParser());

    app.get('/bomb/login', (req, res) => {
        res.redirect('https://v.ruc.edu.cn/oauth2/authorize?' + (new URLSearchParams({
            response_type: 'code',
            scope: 'userinfo profile',
            state: 'yourstate',
            client_id: global.bomblabConfig.vruc_client_id,
            redirect_uri: global.bomblabConfig.server_url + "/bomb/callback/oauth"
        })).toString());
    });

    app.get('/bomb/callback/oauth', async (req, res, next) => {
        try {
            let token = JSON.parse((await promisePost({
                url: "https://v.ruc.edu.cn/oauth2/token",
                form: {
                    client_id: global.bomblabConfig.vruc_client_id,
                    client_secret: global.bomblabConfig.vruc_client_secret,
                    grant_type: 'authorization_code',
                    code: req.query.code as string
                }
            })).body).access_token;

            if (!token)
                throw "Canceled";

            let profile = JSON.parse((await promiseGet({
                url: "https://v.ruc.edu.cn/apis/oauth2/v1/profile",
                auth: {
                    'bearer': token
                }
            })).body) as {
                name: string;
                profiles: {
                    departmentname: string;
                    stno: string;
                }[];

            };

            let identity = profile.profiles.pop();

            res.cookie('user', jwt.sign(identity.stno, global.bomblabConfig.jwt_secret));
            res.redirect('/bomb');
        } catch (error) {
            next(error);
        }
    });

    app.get('/bomb/submit', async (req, res) => {
        try {
            let bombSubmission = req.query as unknown as BombSubmission & { lab: string };

            let lab = labs[bombSubmission.lab];

            if (!lab)
                throw new Error("Invalid lab name");

            let { parsedSubmission, validateSubmission } = await lab.parseBombSubmissionAndValidate(bombSubmission);

            let submission = new Submission();
            submission.studentId = parsedSubmission.userid;
            submission.submitTime = new Date();
            submission.succeed = parsedSubmission.submittedResult === "accept";
            submission.stage = parsedSubmission.stage;
            submission.info = "";
            submission.input = parsedSubmission.userInput;
            submission.labname = bombSubmission.lab;
            submission.rawSubmission = JSON.stringify(bombSubmission);

            // Make bomb happy
            res.send("OK");

            let judge = submission.succeed && !(await bomblabSubmissionRespository.findOne({
                studentId: parsedSubmission.userid,
                labname: bombSubmission.lab,
                stage: parsedSubmission.stage,
                succeed: true
            }));

            await bomblabSubmissionRespository.save(submission);

            if (judge) {
                // Validate

                let result = await validateSubmission();

                // let searchResult = (await bomblab.query("select stage, input from submission inner join (select studentId, MAX(submitTime) as time from submission where studentId = ? and labname == ? and succeed = ? group by stage) subquery on submission.studentId = subquery.studentId and submission.submitTime = subquery.time;", [params.userid, params.lab, true])) as {
                //     stage: number;
                //     input: string;
                // }[];

                // let inputs = (await fsPromises.readFile(`${global.bomblabConfig.bomblab_path}/bombs/bomb${bomb_id}/solution.txt`)).toString().split('\n');

                // for (const { stage, input } of searchResult) {
                //     inputs[stage - 1] = input;
                // }

                // let input = inputs.join('\n');

                // let bombResult = await runBomb(input, submission.studentId);

                if (result.result === "error") {
                    submission.succeed = false;
                }

                submission.info = result.info;
            }
            else {
                submission.info = "Skipped";
            }
            await bomblabSubmissionRespository.save(submission);
        }
        catch (error) {
            res.send(error);
        }
    });

    app.get('/bomb', (req, res, next) => {
        res.type("html");
        res.write("<a href=\"/bomb/login\">Login</a><br>\r\n");
        res.write("<h3>Bombs</h3>\r\n");

        for (const labname in labs) {
            res.write(`<a href="/bomb/download/${labname}">${labname}</a><br>\r\n`);
        }
        res.end();
    })

    app.get('/bomb/download/:labname', async (req, res, next) => {
        try {
            let token = req.cookies.user;
            if (!token)
                throw new Error("Unauthorized");
            try {
                jwt.verify(token, global.bomblabConfig.jwt_secret);
            }
            catch (error) {
                res.clearCookie("user");
                throw new Error("Invalid token");
            }
            let studentId = jwt.decode(token) as string;

            if (!req.params.labname || !(req.params.labname in labs))
                throw new Error("Invalid lab name");

            let labname = req.params.labname;
            let lab = labs[labname];

            let user = await bomblabUserBombRespository.findOne({ studentId: studentId, labname: labname });

            if (!user) {
                user = new UserBomb();
                user.studentId = studentId;
                user.labname = labname;
                user.binaryCompileStatus = BinaryCompileStatus.none;
                user.compilerInfo = "";
                await bomblabUserBombRespository.save(user);
            }

            if (user.binaryCompileStatus == BinaryCompileStatus.none) {
                user.binaryCompileStatus = BinaryCompileStatus.compiling;
                await bomblabUserBombRespository.save(user);
                lab.getBomb(studentId).then(async () => {
                    user.binaryCompileStatus = BinaryCompileStatus.compiled;
                    user.compilerInfo = "";
                    await bomblabUserBombRespository.save(user);
                }).catch(async (error) => {
                    user.binaryCompileStatus = BinaryCompileStatus.none;
                    user.compilerInfo = JSON.stringify(error);
                    await bomblabUserBombRespository.save(user);
                });
                res.send(`Start compiling. <br/> Last compile status (if exists): ${user.compilerInfo}`);
                return;
            }
            else if (user.binaryCompileStatus == BinaryCompileStatus.compiling) {
                res.send(`Still compiling. <br/> Last compile status (if exists): ${user.compilerInfo}`);
                return;
            }

            if (req.query.download) {
                let bombPath = await lab.getBomb(studentId);
                console.log(studentId, bombPath);

                res.sendFile(bombPath,
                    { root: '.' },
                    function (err) {
                        if (err) {
                            next(err)
                        } else {
                            console.log('Sent:', bombPath)
                        }
                    });
            }
            else {
                res.send(`<html><head></head><body>Start downloading<script>window.location.href='/bomb/download/${labname}?download=1';</script></body></html>`);
            }
        }
        catch (error) {
            res.send('message' in error ? error.message : JSON.stringify(error));
        }
    });

    app.get('/bomb/stats', async (req, res, next) => {
        try {
            let users = (await bomblabUserBombRespository.createQueryBuilder("user")
                .select("studentId")
                .distinct(true)
                .execute() as { studentId: string }[]).map(x => x.studentId);
            let userBoomCount = Object.fromEntries((await bomblabSubmissionRespository.createQueryBuilder("submission")
                .select(["studentId", "labname", "stage", "COUNT(*) AS boomcount"])
                .where("succeed = 0")
                .groupBy("studentId, labname, stage").execute() as {
                    studentId: string;
                    labname: string;
                    stage: number;
                    boomcount: number;
                }[]).map(result => [[result.studentId, result.labname, result.stage].toString(), result]));
            let userPassedStage = Object.fromEntries((await bomblabSubmissionRespository.createQueryBuilder('submission')
                .select(["studentId", "labname", "stage"])
                .where("succeed = 1")
                .groupBy("studentId, labname, stage").execute() as {
                    studentId: string;
                    labname: string;
                    stage: number;
                }[]).map(result => [[result.studentId, result.labname, result.stage].toString(), result]))
            let userScore = Object.fromEntries((await bomblabSubmissionRespository.createQueryBuilder("submission").select(["studentId", "COUNT(DISTINCT stage) AS score"])
                .where("succeed = 1")
                .groupBy("studentId").execute() as {
                    studentId: string;
                    score: number;
                }[]).map(result => [result.studentId, result]));
            let result: {
                studentId: string;
                stages: { labname: string; stagename: string; booms: number; passed: boolean; }[];
                score: number;
            }[];
            result = users.map(username => {
                let ret = {
                    studentId: username,
                    stages: [],
                    score: username in userScore ? userScore[username].score : 0
                };

                for (const labname in labs) {
                    const lab = labs[labname];
                    for (const id in lab.stageInfo) {
                        let { name, hidden } = lab.stageInfo[id];
                        let tmp = {
                            labname: labname,
                            stagename: name,
                            booms: 0,
                            passed: false
                        }
                        if ([username, labname, id].toString() in userBoomCount)
                            tmp.booms = userBoomCount[[username, labname, id].toString()].boomcount;

                        if ([username, labname, id].toString() in userPassedStage)
                            tmp.passed = true;
                        ret.stages.push(tmp);
                    }
                }

                return ret;
            })
            res.type('json');
            res.send(JSON.stringify(result, null, 2));
        } catch (error) {
            next(error);
        }
    });

    app.listen(global.bomblabConfig.server_listen_port, '0.0.0.0', () => {
        console.log(`Bomblab server is listening at http://0.0.0.0:${global.bomblabConfig.server_listen_port}`)
    })

    // let userRository = connections[1].getRepository(User);
    // let user1 = await userRository.find({ id: 1 });
    // console.log(user1);
}

main();
