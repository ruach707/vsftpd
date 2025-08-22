Visão geral

Imagem Debian (bookworm-slim) com vsftpd 3.x, compatível amd64/arm64, usuários locais, chroot por usuário, modo passivo, FTPS opcional, logs persistentes.


Subir rápido
docker run -d --name vsftpd \
  -p 21:21 -p 20:20 -p 21100-21110:21100-21110 \
  -e FTP_USERS=admin:admin123 \
  -e PASV_ENABLE=YES -e PASV_MIN_PORT=21100 -e PASV_MAX_PORT=21110 \
  -e PASV_ADDRESS=SEU_IP_OU_FQDN -e PASV_ADDR_RESOLVE=NO \
  -v $PWD/data:/data -v $PWD/logs:/var/log/vsftpd \
  ruach707/vsftpd:v1.0.0

Variáveis importantes
FTP_USERS — "user:pass;user2:pass2" (cria/atualiza usuários locais com chroot).
FTP_ROOT — raiz dos dados (default /data). Cada user fica em /data/<user>.
PUID/PGID — owner no volume (evita arquivos root:root).
PASV_ENABLE — YES/NO.
PASV_MIN_PORT/PASV_MAX_PORT — faixa passiva (abra no firewall/NAT).
PASV_ADDRESS — IP/FQDN público (crucial atrás de NAT).
FTP_TLS — YES para FTPS (gera self-signed se não montar cert).
LOCAL_UMASK/FILE_OPEN_MODE — criação de arquivos (default 022 / 0666).
TZ — fuso horário.

Gerenciar os usuários:
# criar/atualizar
docker exec -it vsftpd add-ftp-user.sh alice 'Senha.Forte#2025'

# desativar / reativar
docker exec -it vsftpd del-ftp-user.sh alice --disable
docker exec -it vsftpd del-ftp-user.sh alice --enable

# remover (manter home) / remover e apagar home
docker exec -it vsftpd del-ftp-user.sh alice --delete
docker exec -it vsftpd del-ftp-user.sh alice --delete -r
