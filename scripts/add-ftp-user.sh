#!/usr/bin/env bash
set -euo pipefail


# Uso: add-ftp-user.sh <usuario> <senha>


FTP_ROOT="${FTP_ROOT:-/data}"


err() { echo "[ERROR] $*" >&2; exit 1; }
msg() { echo "[INFO] $*"; }


validate_username() {
local name="$1"
[[ "$name" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,31}$ ]] || return 1
}


if [[ $# -lt 2 ]]; then
echo "Uso: $0 <usuario> <senha>"
exit 1
fi


USER="$1"
PASS="$2"


validate_username "$USER" || err "Nome de usuário inválido: '$USER'"


mkdir -p "$FTP_ROOT"
chmod 755 "$FTP_ROOT"


USER_HOME="${FTP_ROOT}/${USER}"


if id -u "$USER" >/dev/null 2>&1; then
msg "Usuário já existe: $USER (atualizando senha e diretório)"
echo "${USER}:${PASS}" | chpasswd
mkdir -p "$USER_HOME"
chown -R "$USER:$USER" "$USER_HOME"
chmod 755 "$USER_HOME"
else
useradd -m -d "$USER_HOME" -s /usr/sbin/nologin "$USER"
echo "${USER}:${PASS}" | chpasswd
mkdir -p "$USER_HOME"
chown -R "$USER:$USER" "$USER_HOME"
chmod 755 "$USER_HOME"
msg "Usuário criado: $USER"
fi


msg "Home: $USER_HOME"
msg "Concluído."
