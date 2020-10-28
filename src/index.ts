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

import bodyParser from "body-parser";

const promiseGet = promisify(request.get);
const promisePost = promisify(request.post);

global.bomblabConfig = JSON.parse(readFileSync('./configs/global.json').toString()) as BomblabGlobalConfig;

async function main() {
    let labs: { [name: string]: BombLabBase } = {};
    let labList: string[] = [];

    {
        let lab_: [number, string][] = [];
        const labnames = await fsPromises.readdir(__dirname + '/labs');
        for (let labname of labnames.filter(name => path.extname(name) === '.js')) {
            labname = path.basename(labname, '.js');
            let lab = require(`./labs/${labname}`).default as { new(config: any): BombLabBase };
            let labconfig = JSON.parse((await fsPromises.readFile(`./configs/${labname}.json`)).toString());
            labs[labname] = new lab(labconfig);
            lab_.push([labs[labname].weight, labname]);
        }
        lab_.sort((a, b) => a[0] - b[0]);
        labList = lab_.map(a => a[1]);
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

    let getBombStats = async () => {
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
            stages: { labname: string; stagename: string; }[];
            students: {
                studentId: string;
                stages: { labname: string; stagename: string; booms: number; passed: boolean; }[];
                score: number;
            }[]
        } = { stages: undefined, students: undefined };
        let stages: { labname: string; id: string; stagename: string; }[] = [];
        for (const labname of labList) {
            const lab = labs[labname];
            for (const id in lab.stageInfo) {
                stages.push({ labname: labname, id: id, stagename: lab.stageInfo[id].name });
            }
        }
        result.stages = stages.map(stage => { return { labname: stage.labname, stagename: stage.stagename } });
        result.students = users.map(username => {
            let ret = {
                studentId: username,
                stages: [],
                score: username in userScore ? userScore[username].score : 0
            };

            for (let stage of stages) {
                let { labname, id, stagename } = stage;
                let tmp = {
                    labname: labname,
                    stagename: stagename,
                    booms: 0,
                    passed: false
                }
                if ([username, labname, id].toString() in userBoomCount)
                    tmp.booms = userBoomCount[[username, labname, id].toString()].boomcount;

                if ([username, labname, id].toString() in userPassedStage)
                    tmp.passed = true;
                ret.stages.push(tmp);
            }

            return ret;
        })
        return result;
    }

    const app = express()
    app.use(cookieParser());
    app.use(bodyParser.text({ type: 'text/bomb' }))
    app.set('view engine', 'ejs');
    app.set('views', './src/views')

    app.get('/bomb/check', async (req, res) => {
        try {
            let query = req.query as {
                userid: string;
                userpwd: string;
                lab: string;
            };

            if (query.lab in labs){
                let lab = labs[query.lab];
                if (query.userpwd == await lab.getPassword(query.userid))
                    return res.status(200).send("OK");
            }
            
            res.status(401).send("Fail");
        } catch(error) {
            console.log(error);
            res.status(401).send("Fail");
        }
    })

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

    let processSubmit = async (bombSubmission: BombSubmission & { lab: string }) => {
        let lab = labs[bombSubmission.lab];

        if (!lab) {
            console.log("Invalid lab: ", JSON.stringify(bombSubmission));
            throw new Error("Invalid lab name");
        }

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

        let judge = submission.succeed && !(await bomblabSubmissionRespository.findOne({
            studentId: parsedSubmission.userid,
            labname: bombSubmission.lab,
            stage: parsedSubmission.stage,
            succeed: true
        }));

        await bomblabSubmissionRespository.save(submission);

        if (judge) {

            let result = await validateSubmission();

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

    app.get('/bomb/submit', async (req, res) => {
        try {
            let bombSubmission = req.query as unknown as BombSubmission & { lab: string };

            // Make bomb happy
            res.send('OK');

            await processSubmit(bombSubmission);
        }
        catch (error) {
            res.send(error);
        }
    });

    app.post('/bomb/submit', async (req, res) => {
        try {
            let bombSubmission = req.query as unknown as BombSubmission & { lab: string };
            bombSubmission.result = req.body;

            await processSubmit(bombSubmission);
        }
        catch (error) {
            res.send(error);
        }
    });

    app.get('/bomb', async (req, res, next) => {
        try {
            let token = req.cookies.user;
            if (!token)
                return res.redirect("/bomb/login");
            try {
                jwt.verify(token, global.bomblabConfig.jwt_secret);
            }
            catch (error) {
                res.clearCookie("user");
                return res.redirect("/bomb/login");
            }
            let studentId = jwt.decode(token) as string;
            let compileStatus = Object.fromEntries((await bomblabUserBombRespository
                .find({ studentId: studentId }))
                .map(status => [status.labname, { status: status.binaryCompileStatus.toString(), message: status.compilerInfo }]));
            res.render("bomb", {
                labs: labList.map(name => [name, (name in compileStatus) ? compileStatus[name] : { status: 'none', message: "" }])
            });
        } catch (error) {
            res.send('message' in error ? error.message : JSON.stringify(error));
        }
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

    app.get('/bomb/scoreboard', async (req, res, next) => {
        try {
            let result = await getBombStats();
            res.render('scoreboard', result);
        } catch (error) {
            res.send('message' in error ? error.message : JSON.stringify(error));
        }
    })

    app.get('/bomb/json', async (req, res, next) => {
        try {
            let result = await getBombStats();
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
