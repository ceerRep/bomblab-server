import { BombSubmission, ParsedBombSubmission, BombJudgeResult, BombLabBase } from "../lab";
import { promises as fsPromises } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { pushSandboxJob } from "../sandbox";
import { SandboxStatus } from "simple-sandbox";
import path from "path";

const promiseExecFile = promisify(execFile);

interface BombLabConfig {
    bomblab_path: string;
    bomblab_mount_path: string;
}

interface BombLabSubmission extends BombSubmission {
    userpwd: string;
    result: string;
    submit: string;
}

export default class BombLab extends BombLabBase {
    stageInfo = {
        "1": {name: "1", hidden: false},
        "2": {name: "2", hidden: false},
        "3": {name: "3", hidden: false},
        "4": {name: "4", hidden: false},
        "5": {name: "5", hidden: false},
        "6": {name: "6", hidden: false},
        "7": {name: "hidden", hidden: true}
    };
    #config: BombLabConfig;

    constructor(config: any) {
        super(config);
        this.#config = config as BombLabConfig;
    }

    getBomb = async (studentId: string): Promise<string> => {
        try {
            await fsPromises.access(`${this.#config.bomblab_path}/bombs/bomb${studentId}/README`);
            await fsPromises.access(`${this.#config.bomblab_path}/bombs/bomb${studentId}/bomb`);
            await fsPromises.access(`${this.#config.bomblab_path}/bombs/bomb${studentId}/bomb.c`);
        } catch (error) {
            let result = await this.compileBinary(studentId);

            if (result.result !== 'okay')
                throw new Error(`Error compiling binary: ${JSON.stringify(result)}`);
        }

        let stdout, stderr;

        await fsPromises.access(`${this.#config.bomblab_path}/bombs/bomb${studentId}/bomb${studentId}.tar`).catch(async () => {
            let ret = await promiseExecFile('/bin/tar',
                ['cvf', `bomb${studentId}.tar`, 'README', 'bomb', 'bomb.c'], {
                cwd: `${this.#config.bomblab_path}/bombs/bomb${studentId}/`,
                timeout: 5000
            }).catch((reason: any) => {
                throw new Error(`Error packing bomb binary: ${('message' in reason) ? reason.message : JSON.stringify(reason)}`);
            });
            stdout = ret.stdout;
            stderr = ret.stderr;
        });

        await fsPromises.access(`${this.#config.bomblab_path}/bombs/bomb${studentId}/bomb${studentId}.tar`).catch(() => {
            throw new Error(`Error packing bomb binary:\nstdout: ${stdout}\nstderr: ${stderr}`);
        })

        return `${this.#config.bomblab_path}/bombs/bomb${studentId}/bomb${studentId}.tar`;
    };

    parseBombSubmissionAndValidate = async (submission: BombSubmission): Promise<{
        parsedSubmission: ParsedBombSubmission;
        validateSubmission: () => Promise<BombJudgeResult>;
    }> => {
        let realSubmission = submission as BombLabSubmission;

        let [bomb_id, defused, num_input_strings, ...last_input_string_splited] = realSubmission.result.split(':');
        let last_input_string = last_input_string_splited.join(':');

        let realPwd = (await fsPromises.readFile(`${this.#config.bomblab_path}/bombs/bomb${bomb_id}/PASSWORD`)).toString().trim();

        if (realPwd != realSubmission.userpwd)
            throw new Error("Wrong Password");

        const parsedSubmission: ParsedBombSubmission = {
            userid: realSubmission.userid,
            stage: num_input_strings,
            userInput: last_input_string,
            submittedResult: defused == 'defused' ? 'accept' : 'error'
        }

        return {
            parsedSubmission: parsedSubmission,
            validateSubmission: () => this.runBomb(parsedSubmission)
        };
    };

    compileBinary = async (studentId: string): Promise<{ result: "okay" | "error" | "unknown" }> => {
        let ret: { result: "okay" | "error" | "unknown" };
        try {
            let result = await pushSandboxJob({
                time: 5000,
                memory: 256 * 1024 * 1024,
                process: 32,
                mounts: [{
                    src: this.#config.bomblab_path,
                    dst: this.#config.bomblab_mount_path,
                    limit: 10 * 1024 * 1024
                }],
                redirectBeforeChroot: true,
                executable: "/usr/bin/perl",
                stdin: undefined,
                stdout: `./sandbox-output/${studentId}.stdout`,
                stderr: `./sandbox-output/${studentId}.stderr`,
                parameters: [
                    "/usr/bin/perl",
                    "./makebomb.pl",
                    "-n",
                    "-l",
                    "ruclab",
                    "-i",
                    studentId,
                    "-b",
                    "./bombs",
                    "-s",
                    "./src",
                    "-u",
                    `${studentId}@ruc.edu.cn`,
                    "-v",
                    studentId
                ],
                environments: ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"],
                workingDirectory: this.#config.bomblab_mount_path,
                stackSize: -1
            });
            let info = {
                stdout: "",
                stderr: "",
                status: result.status,
                code: result.code
            };
            info.stdout = await fsPromises.readFile(`./sandbox-output/${studentId}.stdout`).then((value) => {
                return value.toString();
            }).catch(() => "");
            info.stderr = await fsPromises.readFile(`./sandbox-output/${studentId}.stderr`).then((value) => {
                return value.toString();
            }).catch(() => "");
            ret = { result: info.status == SandboxStatus.OK && info.code == 0 ? "okay" : "error", ...info };
        } catch (error) {
            let info = { reason: ('message' in error) ? error.message : JSON.stringify(error) };
            ret = { result: "unknown", ...info };
        }

        if (ret.result !== "okay") {
            await fsPromises.rmdir(`${this.#config.bomblab_path}/bombs/bomb${studentId}`).catch(() => null);
        }

        return ret;
    }

    runBomb = async (submission: ParsedBombSubmission): Promise<BombJudgeResult> => {
        let inputs = (await fsPromises.readFile(`${this.#config.bomblab_path}/bombs/bomb${submission.userid}/solution.txt`)).toString().split('\n');
        inputs[parseInt(submission.stage) - 1] = submission.userInput.trim();
        let input = inputs.join('\n');

        try {
            await fsPromises.writeFile(`./sandbox-output/${submission.userid}.stdin`, input);
            let result = await pushSandboxJob({
                time: 5000,
                memory: 256 * 1024 * 1024,
                process: 32,
                mounts: [{
                    src: path.join(this.#config.bomblab_path, "bombs", `bomb${submission.userid}`),
                    dst: this.#config.bomblab_mount_path,
                    limit: 0
                }],
                redirectBeforeChroot: true,
                executable: path.join(this.#config.bomblab_mount_path, "bomb-quiet"),
                stdin: `./sandbox-output/${submission.userid}.stdin`,
                stdout: `./sandbox-output/${submission.userid}.stdout`,
                stderr: `./sandbox-output/${submission.userid}.stderr`,
                parameters: [path.join(this.#config.bomblab_mount_path, "bomb-quiet")],
                environments: ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"],
                workingDirectory: this.#config.bomblab_mount_path,
                stackSize: -1
            });

            return {
                result: result.code == 0 ? 'accept' : 'error',
                info: JSON.stringify({
                    stdout: (await fsPromises.readFile(`./sandbox-output/${submission.userid}.stdout`).catch(() => "")).toString(),
                    stderr: (await fsPromises.readFile(`./sandbox-output/${submission.userid}.stdout`).catch(() => "")).toString()
                })
            };
        } catch (error) {
            return { result: 'error', info: 'message' in error ? error.message : JSON.stringify(error) };
        }
    }
}
