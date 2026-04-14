# 🔐 Guia Rápido - Dashboard FTP Management

## 1️⃣ Como Trocar a Senha de Admin

### Opção A: Via Interface Web (Recomendado)
1. Faça login no dashboard
2. Clique em **🔑 Trocar Senha** (canto superior direito)
3. Digite a senha atual
4. Digite a nova senha (mínimo 6 caracteres)
5. Confirme a nova senha
6. Clique em "Alterar Senha"
7. A nova senha será válida na próxima sessão

### Opção B: Via Variável de Ambiente (Na Inicialização)
```bash
# docker-compose.yml - adicionar ao serviço frontend:
environment:
  - ADMIN_PASSWORD=sua_nova_senha_aqui

# Depois reconstruir:
docker-compose down
docker-compose pull
docker-compose up -d
```

---

## 2️⃣ Usuários Não Aparecem? 

### Problema
Os usuários FTP criados no container não aparecem na lista do dashboard.

### Causa
O sistema agora lista usuários do `/etc/passwd` em vez de diretórios em `/data`. Isso é mais preciso pois identifica apenas usuários FTP válidos.

### Solução

**Verificar se os usuários existem no container:**
```bash
docker exec vsftpd cat /etc/passwd | grep '/data'
```

**Se não aparecerem, criar usuários manualmente:**
```bash
# No container
docker exec -it vsftpd /usr/local/bin/add-ftp-user.sh alice senha123
docker exec -it vsftpd /usr/local/bin/add-ftp-user.sh bob senha456

# Ou via dashboard (após login)
# Ir para a seção "Adicionar Novo Usuário"
```

**Se os usuários existem mas não aparecem:**
1. Verificar permissões do arquivo `/etc/passwd`:
   ```bash
   docker exec vsftpd ls -la /etc/passwd
   ```

2. Limpar logs e reiniciar:
   ```bash
   docker-compose down
   docker-compose up -d
   ```

3. Verificar logs do frontend:
   ```bash
   docker logs vsftpd-frontend -f
   ```

---

## 3️⃣ Credenciais Padrão

| Item | Valor |
|------|-------|
| **Usuário** | admin |
| **Senha** | admin123 |
| **URL** | http://localhost:3000 |

---

## 4️⃣ Recursos Disponíveis

### ✅ Login Seguro
- Autenticação com bcryptjs
- Sessões HTTP-only
- Logout automático após 1 hora

### ✅ Dashboard
- Listar todos os usuários FTP
- Adicionar novo usuário
- Desativar/reativar usuário
- Remover usuário (com opção de apagar home)
- Ver últimos 50 logs do FTP

### ✅ Administração
- Trocar senha de admin
- Interface responsiva (mobile-friendly)

---

## 5️⃣ Atualizar na VPS

Após fazer pull das novas mudanças no Docker Hub:

```bash
cd /opt/ruach-vsftpd
docker-compose down
docker-compose pull
docker-compose up -d
```

Novo link do Docker Hub:
- vsftpd: `ruach707/vsftpd:latest`
- frontend: `ruach707/vsftpd-frontend:latest` (v2.2.0)

---

## 🐛 Troubleshooting

### Problema: "Nenhum usuário FTP encontrado"
**Solução**: 
- Criar usuários via dashboard ou CLI
- Verificar comando: `docker exec vsftpd grep '/data' /etc/passwd`

### Problema: Logs não aparecem
**Solução**:
- Verificar se o arquivo existe: `docker exec vsftpd ls -la /var/log/vsftpd/vsftpd.log`
- Ver logs do container: `docker logs vsftpd`

### Problema: Não consegue fazer login
**Solução**:
- Verificar credenciais: admin / admin123
- Resetar container: `docker-compose restart frontend`
- Ver logs: `docker logs vsftpd-frontend`

---

## 📱 Acesso Remoto

**Na VPS (exemplo IP 134.65.51.132):**
- Dashboard: `http://134.65.51.132:3000`
- FTP: `ftp://134.65.51.132:21`

**Importante**: Se usar HTTPS em produção, atualizar `app.js`:
```javascript
cookie: { 
  secure: true,  // Mudou de false para true
  httpOnly: true 
}
```

---

## 📊 Versão Atual

- **Frontend**: v2.2.0
- **Backend**: v2.0.0
- **Data**: Abril 14, 2026
