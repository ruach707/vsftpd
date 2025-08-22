#!/usr/bin/env bash
set -euo pipefail

# ---- Vars ----
FTP_ROOT="${FTP_ROOT:-/data}"
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

PASV_ENABLE="${PASV_ENABLE:-YES}"
PASV_MIN_PORT="${PASV_MIN_PORT:-21100}"
PASV_MAX_PORT="${PASV_MAX_PORT:-21110}"
PASV_ADDRESS="${PASV_ADDRESS:-}"
PASV_ADDR_RESOLVE="${PASV_ADDR_RESOLVE:-NO}"

LOG_STDOUT="${LOG_STDOUT:-YES}"
FILE_OPEN_MODE="${FILE_OPEN_MODE:-0666}"
LOCAL_UMASK="${LOCAL_UMASK:-022}"
PASV_PROMISCUOUS="${PASV_PROMISCUOUS:-NO}"
PORT_PROMISCUOUS="${PORT_PROMISCUOUS:-NO}"

FTP_TLS="${FTP_TLS:-NO}"
TLS_CRT_PATH="${TLS_CRT_PATH:-/etc/ssl/private/vsftpd.crt}"
TLS_KEY_PATH="${TLS_KEY_PATH:-/etc/ssl/private/vsftpd.key}"

TZ="${TZ:-Etc/UTC}"
FTP_LOGIN_SHELL="${FTP_LOGIN_SHELL:-/usr/sbin/nologin}"

# ---- Timezone ----
if [ -f "/usr/share/zoneinfo/$TZ" ]; then
  ln -sf "/usr/share/zoneinfo/$TZ" /etc/localtime
  echo "$TZ" > /etc/timezone
fi

# ---- PAM shells ----
grep -qxF "$FTP_LOGIN_SHELL" /etc/shells || echo "$FTP_LOGIN_SHELL" >> /etc/shells
grep -qxF "/bin/false"       /etc/shells || echo "/bin/false"       >> /etc/shells

# ---- UID/GID base para o volume ----
if ! getent group "$PGID" >/dev/null; then
  groupadd -g "$PGID" ftpgroup || true
fi
if ! id -u "$PUID" >/dev/null 2>&1; then
  useradd -u "$PUID" -g "$PGID" -M -s /usr/sbin/nologin ftpuser || true
fi

# ---- Diretórios ----
mkdir -p "$FTP_ROOT" /var/log/vsftpd /run/vsftpd /var/run/vsftpd/empty
chown -R "$PUID:$PGID" "$FTP_ROOT"
chmod 755 "$FTP_ROOT"
chown root:root /var/run/vsftpd/empty
chmod 755 /var/run/vsftpd/empty

# ---- Logging ----
touch /var/log/vsftpd/vsftpd.log
chmod 644 /var/log/vsftpd/vsftpd.log
if [ -n "$LOG_STDOUT" ] && [ "$LOG_STDOUT" != "0" ]; then
  tail -F /var/log/vsftpd/vsftpd.log &
fi

# ---- Usuários declarativos (FTP_USERS="u1:p1;u2:p2") ----
if [ -n "${FTP_USERS:-}" ]; then
  IFS=';' read -ra PAIRS <<< "$FTP_USERS"
  for pair in "${PAIRS[@]}"; do
    USER="${pair%%:*}"
    PASS="${pair#*:}"
    [ -z "$USER" ] || [ -z "$PASS" ] && continue
    HOME_DIR="$FTP_ROOT/$USER"
    if id -u "$USER" >/dev/null 2>&1; then
      echo "$USER:$PASS" | chpasswd
      mkdir -p "$HOME_DIR"
      chown -R "$USER:$USER" "$HOME_DIR"
      chmod 755 "$HOME_DIR"
    else
      useradd -m -d "$HOME_DIR" -s "$FTP_LOGIN_SHELL" "$USER"
      echo "$USER:$PASS" | chpasswd
      mkdir -p "$HOME_DIR"
      chown -R "$USER:$USER" "$HOME_DIR"
      chmod 755 "$HOME_DIR"
      echo "[INFO] Usuário criado: $USER"
    fi
  done
fi

# ---- Render vsftpd.conf ----
CONF="/etc/vsftpd/vsftpd.conf"
cp /etc/vsftpd/vsftpd.conf.tmpl "$CONF"

sed -i "s|{{FTP_ROOT}}|$FTP_ROOT|g" "$CONF"
sed -i "s|{{PASV_ENABLE}}|$PASV_ENABLE|g" "$CONF"
sed -i "s|{{PASV_MIN_PORT}}|$PASV_MIN_PORT|g" "$CONF"
sed -i "s|{{PASV_MAX_PORT}}|$PASV_MAX_PORT|g" "$CONF"
sed -i "s|{{PASV_ADDR_RESOLVE}}|$PASV_ADDR_RESOLVE|g" "$CONF"
sed -i "s|{{FILE_OPEN_MODE}}|$FILE_OPEN_MODE|g" "$CONF"
sed -i "s|{{LOCAL_UMASK}}|$LOCAL_UMASK|g" "$CONF"
sed -i "s|{{PASV_PROMISCUOUS}}|$PASV_PROMISCUOUS|g" "$CONF"
sed -i "s|{{PORT_PROMISCUOUS}}|$PORT_PROMISCUOUS|g" "$CONF"

if [ -n "$PASV_ADDRESS" ]; then
  echo "pasv_address=$PASV_ADDRESS" >> "$CONF"
fi

# ---- TLS opcional ----
if [ "$FTP_TLS" = "YES" ]; then
  mkdir -p "$(dirname "$TLS_CRT_PATH")" "$(dirname "$TLS_KEY_PATH")"
  if [ ! -f "$TLS_CRT_PATH" ] || [ ! -f "$TLS_KEY_PATH" ]; then
    echo "[INFO] Gerando certificado self-signed TLS..."
    openssl req -x509 -nodes -days 3650 \
      -newkey rsa:2048 \
      -keyout "$TLS_KEY_PATH" \
      -out "$TLS_CRT_PATH" \
      -subj "/C=BR/ST=SP/L=SaoPaulo/O=Z3/OU=FTP/CN=vsftpd"
    chmod 600 "$TLS_KEY_PATH"
  fi
  {
    echo "ssl_enable=YES"
    echo "allow_anon_ssl=NO"
    echo "force_local_data_ssl=YES"
    echo "force_local_logins_ssl=YES"
    echo "rsa_cert_file=$TLS_CRT_PATH"
    echo "rsa_private_key_file=$TLS_KEY_PATH"
    echo "ssl_tlsv1=YES"
    echo "ssl_sslv2=NO"
    echo "ssl_sslv3=NO"
  } >> "$CONF"
else
  echo "ssl_enable=NO" >> "$CONF"
fi

echo "[INFO] Configuração finalizada. Iniciando vsftpd..."
exec "$@"

