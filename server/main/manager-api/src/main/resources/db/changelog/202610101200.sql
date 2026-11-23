ALTER TABLE sys_user
    ADD COLUMN idone_issuer VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
    ADD COLUMN idone_subject VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
    ADD UNIQUE KEY uk_idone_identity (idone_issuer, idone_subject),
    DROP INDEX uk_username;

-- username 仅用于展示；账号身份由 issuer / subject 唯一确定。
