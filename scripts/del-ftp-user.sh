#!/usr/bin/env bash
set -euo pipefail


# Uso:
# del-ftp-user.sh <usuario> --disable
# del-ftp-user.sh <usuario> --enable
# del-ftp-user.sh <usuario> --delete [-r]


FTP_ROOT="${FTP_ROOT:-/data}"


err() { echo "[ERROR] $*" >&2; exit 1; }
msg() { echo "[INFO] $*"; }


validate_username() {
local name="$1"
[[ "$name" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,31}$ ]] || return 1
}


if [[ $# -lt 1 ]]; then
echo "Uso:"
echo " $0 <usuario> --disable"
echo " $0 <usuario> --enable"
echo " $0 <usuario> --delete [-r]"
exit 1
fi


USER="$1"; shift
validate_username "$USER" || err "Nome de usuário inválido: '$USER'"


ACTION="--disable"
REMOVE_HOME="no"


while [[ $# -gt 0 ]]; do
case "$1" in
--disable) ACTION="--disable" ;;
--enable) ACTION="--enable" ;;
--delete) ACTION="--delete" ;;
-r|--remove-home) REMOVE_HOME="yes" ;;
*) err "Parâmetro desconhecido: $1" ;;
esac
shift
done


if ! id -u "$USER" >/dev/null 2>&1; then
err "Usuário não existe: $USER"
fi


case "$ACTION" in
--disable)
usermod -L "$USER"
msg "Login desativado (locked) para: $USER"
;;
--enable)
usermod -U "$USER"
msg "Login reativado (unlocked) para: $USER"
;;
--delete)
if [[ "$REMOVE_HOME" == "yes" ]]; then
userdel -r "$USER"
msg "Usuário removido com home: $USER"
else
userdel "$USER"
msg "Usuário removido (home mantido): $USER"
fi
;;
*)
err "Ação inválida."
;;
esac


msg "Concluído."
