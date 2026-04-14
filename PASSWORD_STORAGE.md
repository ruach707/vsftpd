# 📋 Armazenamento da Senha de Admin

## ❓ Onde a Senha Fica Armazenada?

A senha de administrador é armazenada em **2 lugares**:

### 1️⃣ Arquivo Persistente (Principal)
**Localização**: `/tmp/admin_password.hash` (dentro do container)

- Armazena o **hash criptografado** da senha (bcrypt)
- Persiste entre reinicializações do container
- É recarregado automaticamente ao iniciar o container

**Verificar (no container):**
```bash
docker exec vsftpd-frontend cat /tmp/admin_password.hash
```

### 2️⃣ Memória (Variável de Runtime)
- Variável `CURRENT_PASSWORD_HASH` em memória
- Usada durante a execução da aplicação
- Sincronizada com o arquivo quando alterada

---

## 🔄 Fluxo de Funcionamento

```
┌─────────────────────────────────────────────────────┐
│ Inicialização do Container                          │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ 1. Verifica env var ADMIN_PASSWORD                  │
│ 2. Se não existe, procura /tmp/admin_password.hash  │
│ 3. Se não existe, usa padrão (admin123)             │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ Carrega em CURRENT_PASSWORD_HASH (memória)          │
└─────────────────────────────────────────────────────┘

                    ↓↑ (uso)

┌─────────────────────────────────────────────────────┐
│ Usuário Troca Senha via Interface                   │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ 1. Atualiza CURRENT_PASSWORD_HASH (memória)         │
│ 2. Salva novo hash em /tmp/admin_password.hash      │
│ 3. Próxima sessão usa a nova senha                  │
└─────────────────────────────────────────────────────┘
```

---

## 🎯 Cenários de Uso

### Cenário 1: Trocar Senha via Dashboard
```
✅ Senha é alterada
✅ Hash é salvo em arquivo
✅ Próxima sessão usa nova senha
✅ Se reiniciar container: senha mantida
```

### Cenário 2: Definir Senha na Inicialização
```bash
# docker-compose.yml
services:
  frontend:
    environment:
      - ADMIN_PASSWORD=minha_senha_forte

# Resultado:
✅ Usa a senha definida na env var
✅ Salva o hash em /tmp/admin_password.hash
✅ Próximas vezes carrega do arquivo
```

### Cenário 3: Resetar para Padrão
```bash
# Entrar no container e remover o arquivo
docker exec vsftpd-frontend rm /tmp/admin_password.hash

# Reiniciar
docker-compose restart frontend

# Resultado: Volta a admin123
```

---

## ⚠️ Importante: Persistência entre Reinicializações

### ✅ O Que Persiste
- Senha alterada via dashboard
- Hash salvo em arquivo `/tmp/admin_password.hash`
- Válido mesmo após `docker-compose down/up`

### ❌ O Que NÃO Persiste (sem volume montado)
Se o arquivo `/tmp/admin_password.hash` estiver em um local sem volume, ele será perdido se:
- Container é removido: `docker-compose down`
- Imagem é criada novamente: `docker-compose up --build`

---

## 🔧 Solução: Montar Volume para Persistência Total

Para garantir que a senha persista **sempre**, adicione um volume no `docker-compose.yml`:

```yaml
services:
  frontend:
    image: ruach707/vsftpd-frontend:latest
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - frontend_config:/app/config  # Novo volume
    
volumes:
  frontend_config:  # Definir volume persistente
    driver: local
```

**Depois:**
1. Mudar localização do arquivo em `app.js`:
   ```javascript
   const PASSWORD_FILE = '/app/config/admin_password.hash';
   ```

2. Fazer rebuild da imagem

---

## 📊 Resumo

| Aspecto | Localização | Persistência | Notas |
|--------|-----------|--------------|-------|
| **Senha (Hash)** | `/tmp/admin_password.hash` | Entre restarts | Sem volume dedicado |
| **Senha em Memória** | `CURRENT_PASSWORD_HASH` | Até reinício | Sincronizada com arquivo |
| **Padrão** | Código | Sempre | admin123 |

---

## 🎁 Próxima Melhoria Recomendada

Implementar suporte a volume dedicado para garantir persistência total:

```bash
# Ver volumes criados
docker volume ls

# Ver dados do volume
docker volume inspect vsftpd_frontend_config
```

Isso garantirá que a senha nunca seja perdida, mesmo após `docker-compose down -v`.
