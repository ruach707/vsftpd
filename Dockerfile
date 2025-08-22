FROM debian:bookworm-slim


ENV DEBIAN_FRONTEND=noninteractive


RUN apt-get update && \
apt-get install -y --no-install-recommends \
vsftpd \
db-util \
libpam-modules \
libpam-modules-bin \
ca-certificates \
openssl \
dumb-init \
tzdata && \
rm -rf /var/lib/apt/lists/*


# Garante shells aceitos pelo pam_shells (evita 530 com nologin/false)
RUN (grep -qxF '/usr/sbin/nologin' /etc/shells || echo '/usr/sbin/nologin' >> /etc/shells) && \
(grep -qxF '/bin/false' /etc/shells || echo '/bin/false' >> /etc/shells)


# Diretórios padrões e chroot seguro do vsftpd
RUN mkdir -p /data /var/log/vsftpd /run/vsftpd /var/run/vsftpd/empty && \
chown -R root:root /var/log/vsftpd /var/run/vsftpd/empty && \
chmod 755 /data /var/run/vsftpd/empty


# Entrypoint e template
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY config/vsftpd.conf.tmpl /etc/vsftpd/vsftpd.conf.tmpl
RUN chmod +x /usr/local/bin/entrypoint.sh


# Scripts auxiliares para gerenciar usuários sem recriar o container
COPY scripts/add-ftp-user.sh /usr/local/bin/add-ftp-user.sh
COPY scripts/del-ftp-user.sh /usr/local/bin/del-ftp-user.sh
RUN chmod +x /usr/local/bin/add-ftp-user.sh /usr/local/bin/del-ftp-user.sh


EXPOSE 21 20


ENTRYPOINT ["/usr/bin/dumb-init", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["/usr/sbin/vsftpd", "/etc/vsftpd/vsftpd.conf"]
