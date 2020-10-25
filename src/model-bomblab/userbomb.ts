import { Index, Entity, PrimaryColumn, Column } from "typeorm";

export enum BinaryCompileStatus {
    none = 'none',
    compiling = 'compiling',
    compiled = 'compiled'
}

@Entity()
@Index(["studentId", "labname"])
export class UserBomb {

    @Index()
    @PrimaryColumn("text")
    studentId: string;

    @Index()
    @PrimaryColumn("text")
    labname: string;

    @Column("text")
    binaryCompileStatus: BinaryCompileStatus;

    @Column("text")
    compilerInfo: string;
}
