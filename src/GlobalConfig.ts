export interface BomblabGlobalConfig {
    syzoj_db_host: string;
    syzoj_db_port: number;
    syzoj_db_user: string;
    syzoj_db_password: string;
    syzoj_db_database: string;

    sandbox_root_path: string;

    server_listen_port: number;
    jwt_secret: string;

    vruc_client_id: string;
    vruc_client_secret: string;
    server_url: string;
}

declare global {
    module NodeJS {
        interface Global {
            bomblabConfig: BomblabGlobalConfig;
        }
    }
}
