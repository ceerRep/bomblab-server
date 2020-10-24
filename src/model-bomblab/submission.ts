import { Index, Entity, Column, PrimaryGeneratedColumn } from "typeorm";

@Entity()
@Index(["studentId", "succeed", "labname", "stage"])
export class Submission {

    @Index()
    @PrimaryGeneratedColumn()
    id: number;

    @Index()
    @Column("text")
    studentId: string;

    @Index()
    @Column("datetime")
    submitTime: Date;

    @Column("boolean")
    succeed: boolean;

    @Column("text")
    labname: string;

    @Column("text")
    stage: string;

    @Column("text")
    input: string;

    @Column("text")
    info: string;

    @Column("text")
    rawSubmission: string;
}
