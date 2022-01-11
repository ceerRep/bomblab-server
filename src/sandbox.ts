import { SandboxParameter, SandboxResult, startSandbox, getUidAndGidInSandbox } from "simple-sandbox";

interface SandboxJob {
    sandboxParam: SandboxParameter;
    resolve: (result: SandboxResult) => void;
    reject: (error: any) => void;
}

const sandboxQueue = new class {
    running: boolean;
    jobs: SandboxJob[];
    private onHaveJob?: () => void;

    constructor() {
        this.running = false;
        this.jobs = [];
        this.onHaveJob = undefined;

        this.ensureRunning();
    }

    ensureRunning = async () => {

        if (this.running)
            return;

        this.running = true;

        while (true) {
            if (this.jobs.length > 0) {
                let nowJob = this.jobs.shift();
                console.log(nowJob.sandboxParam);
                try {
                    let process = startSandbox(nowJob.sandboxParam);
                    let result = await process.waitForStop();
                    nowJob.resolve(result);
                } catch (error) {
                    nowJob.reject(error);
                }
            } else {
                let now = new Promise<void>((resolve, reject) => {
                    this.onHaveJob = () => { resolve(); };
                });
                await now;
                this.onHaveJob = undefined;
            }
        }
    }

    push = (param: Omit<SandboxParameter, "chroot" | "user" | "cgroup" | "mountProc" | "hostname">): Promise<SandboxResult> => {
        return new Promise<SandboxResult>((resolve, reject) => {
            this.jobs.push({
                sandboxParam: {
                    ...param,
                    chroot: global.bomblabConfig.sandbox_root_path,
                    user: getUidAndGidInSandbox(global.bomblabConfig.sandbox_root_path, "nobody"),
                    cgroup: "bomblab",
                    mountProc: true,
                    hostname: "bomblab"
                },
                resolve: resolve,
                reject: reject
            });

            if (this.onHaveJob) {
                this.onHaveJob();
            }
        });

    }
}

const pushSandboxJob = sandboxQueue.push;
export { pushSandboxJob };
