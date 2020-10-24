import * as TypeORM from "typeorm";

@TypeORM.Entity()
export class User {
    static cache = true;

    @TypeORM.PrimaryGeneratedColumn()
    id: number;

    @TypeORM.Index({ unique: true })
    @TypeORM.Column({ nullable: true, type: "varchar", length: 80 })
    username: string;

    @TypeORM.Column({ nullable: true, type: "varchar", length: 120 })
    email: string;

    @TypeORM.Column({ nullable: true, type: "varchar", length: 120 })
    password: string;

    @TypeORM.Column({ nullable: true, type: "varchar", length: 80 })
    nickname: string;

    @TypeORM.Column({ nullable: true, type: "text" })
    nameplate: string;

    @TypeORM.Column({ nullable: true, type: "text" })
    information: string;

    @TypeORM.Index()
    @TypeORM.Column({ nullable: true, type: "integer" })
    ac_num: number;

    @TypeORM.Index()
    @TypeORM.Column({ nullable: true, type: "integer" })
    submit_num: number;

    @TypeORM.Column({ nullable: true, type: "boolean" })
    is_admin: boolean;

    @TypeORM.Index()
    @TypeORM.Column({ nullable: true, type: "boolean" })
    is_show: boolean;

    @TypeORM.Index()
    @TypeORM.Column({ nullable: true, type: "boolean" })
    see_ranklist: boolean;

    @TypeORM.Index()
    @TypeORM.Column({ nullable: true, type: "integer" })
    see_ranklist_locked_until: number;

    @TypeORM.Column({ nullable: true, type: "boolean", default: true })
    public_email: boolean;

    @TypeORM.Column({ nullable: true, type: "boolean", default: true })
    prefer_formatted_code: boolean;

    @TypeORM.Column({ nullable: true, type: "integer" })
    sex: number;

    @TypeORM.Column({ nullable: true, type: "integer" })
    rating: number;

    @TypeORM.Column({ nullable: true, type: "integer" })
    register_time: number;
}
