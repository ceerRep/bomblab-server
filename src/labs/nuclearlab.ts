import { BombSubmission, ParsedBombSubmission, BombJudgeResult, BombLabBase } from "../lab";
import { promises as fsPromises } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { pushSandboxJob } from "../sandbox";
import { SandboxStatus } from "simple-sandbox";
import path from "path";
import { createHash } from "crypto";

const promiseExecFile = promisify(execFile);

interface NuclearLabConfig {
    nuclear_path: string;
    nuclear_mount_path: string;
    nuclear_password_salt: string;
}

interface NuclearLabSubmission extends BombSubmission {
    userpwd: string;
    phase: string;
    status: 'accept' | 'error';
    result: string;
}

export default class NuclearLab extends BombLabBase {
    stageInfo = {
        "1": { name: "pupil", hidden: false },
        "2": { name: "tr1vial", hidden: false },
        "3": { name: "rainb0w", hidden: false },
        "4": { name: "q_math", hidden: false },
        "5": { name: "hothothot", hidden: false },
        "6": { name: "tran$f0rm", hidden: false }
    };
    weight = 2;
    #config: NuclearLabConfig;

    constructor(config: any) {
        super(config);
        this.#config = config as NuclearLabConfig;
    }

    getPassword = (studentId: string): Promise<string> => {
        let md5 = createHash('md5');
        md5.update(studentId);
        md5.update(this.#config.nuclear_password_salt);
        return Promise.resolve(md5.digest('hex').substr(0, 8));
    }

    getBomb = async (studentId: string): Promise<string> => {
        return path.join(this.#config.nuclear_path, "nuclear");
    };

    parseBombSubmissionAndValidate = async (submission: BombSubmission): Promise<{
        parsedSubmission: ParsedBombSubmission;
        validateSubmission: () => Promise<BombJudgeResult>;
    }> => {
        let realSubmission = submission as NuclearLabSubmission;

        let realPwd = await this.getPassword(realSubmission.userid);

        if (realPwd != realSubmission.userpwd)
            throw new Error("Wrong Password");

        const parsedSubmission: ParsedBombSubmission = {
            userid: realSubmission.userid,
            stage: realSubmission.phase,
            userInput: realSubmission.result,
            submittedResult: realSubmission.status
        }

        return {
            parsedSubmission: parsedSubmission,
            validateSubmission: () => this.runBomb(parsedSubmission)
        };
    };

    runBomb = async (submission: ParsedBombSubmission): Promise<BombJudgeResult> => {
        let input = submission.userInput;

        try {
            await fsPromises.writeFile(`./sandbox-output/${submission.userid}.stdin`, input);
            let result = await pushSandboxJob({
                time: 5000,
                memory: 256 * 1024 * 1024,
                process: 32,
                mounts: [{
                    src: this.#config.nuclear_path,
                    dst: this.#config.nuclear_mount_path,
                    limit: 0
                }],
                redirectBeforeChroot: true,
                executable: path.join(this.#config.nuclear_mount_path, "nuclear-quiet"),
                stdin: `./sandbox-output/${submission.userid}.stdin`,
                stdout: `./sandbox-output/${submission.userid}.stdout`,
                stderr: `./sandbox-output/${submission.userid}.stderr`,
                parameters: [path.join(this.#config.nuclear_mount_path, "nuclear-quiet")],
                environments: ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"],
                workingDirectory: this.#config.nuclear_mount_path,
                stackSize: -1
            });

            let stdout = (await fsPromises.readFile(`./sandbox-output/${submission.userid}.stdout`).catch(() => "")).toString();
            let stderr = (await fsPromises.readFile(`./sandbox-output/${submission.userid}.stderr`).catch(() => "")).toString();

            let real_stage = ` ${stderr} `.split('accept').length - 1;

            let ret = {
                result: real_stage !== 0 && real_stage == parseInt(submission.stage) ? 'accept' : 'error',
                info: JSON.stringify({
                    stdout: (await fsPromises.readFile(`./sandbox-output/${submission.userid}.stdout`).catch(() => "")).toString(),
                    stderr: (await fsPromises.readFile(`./sandbox-output/${submission.userid}.stderr`).catch(() => "")).toString()
                }),
                stage: null
            };
            if (ret.result === 'error') ret.stage = real_stage + 1;
            
            return ret as BombJudgeResult;
        } catch (error) {
            return { result: 'error', info: 'message' in error ? error.message : JSON.stringify(error) };
        }
    }
}
