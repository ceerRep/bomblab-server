export interface BombSubmission {
    userid: string;
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

    constructor(config: any) { }

    abstract getBomb(studentId: string): Promise<string>;
    abstract parseBombSubmissionAndValidate(submission: BombSubmission): Promise<{
        parsedSubmission: ParsedBombSubmission;
        validateSubmission: () => Promise<BombJudgeResult>;
    }>;
}
