export interface BombSubmission {
    userid: string;
    result: string;
}

export interface ParsedBombSubmission {
    userid: string;
    stage: string;
    userInput: string;
    submittedResult: 'accept' | 'error';
}

export interface BombJudgeResult {
    result: 'accept' | 'error';
    info: string;
}

export abstract class BombLabBase {
    readonly stageInfo: { [id: string]: { name: string; hidden: boolean; } };
    readonly weight: number;

    constructor(config: any) { }

    abstract getPassword(studentId: string): Promise<string>;
    abstract getBomb(studentId: string): Promise<string>;
    abstract parseBombSubmissionAndValidate(submission: BombSubmission): Promise<{
        parsedSubmission: ParsedBombSubmission;
        validateSubmission: () => Promise<BombJudgeResult>;
    }>;
}
