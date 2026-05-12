# 🍴 Cardápio Bot — WhatsApp

Bot WhatsApp completo para cardápio digital com painel admin, pagamento PIX via Mercado Pago e gestão de pedidos em tempo real.

## Funcionalidades

- Cardápio interativo via WhatsApp (categorias, itens, acréscimos)
- Pagamentos: **PIX** (QR Code automático + confirmação via webhook), **Dinheiro** (cálculo de troco) e **Cartão** (maquininha com entregador)
- Painel admin web: pedidos em tempo real, gerenciar cardápio, configurações
- Notificações WhatsApp ao cliente em cada mudança de status (confirmado → preparando → saiu → entregue)
- Notificação ao admin a cada novo pedido
- Filtro de pedidos por período (hoje, ontem, 7 dias, mês, customizado)
- Histórico de clientes e opção de repetir último pedido
- Avaliação pós-entrega (1–5 estrelas)
- QR Code do WhatsApp exibido diretamente no painel admin
- Reconexão automática com limpeza de sessão expirada

---

## Pré-requisitos

| Requisito | Versão mínima | Observação |
|-----------|--------------|-----------|
| Node.js | 18+ | Testado no v24 |
| Python | 3.8+ | Necessário para compilar `better-sqlite3` e `sharp` |
| VS Build Tools (Windows) | 2022 | Apenas no Windows |

### Windows — instalar dependências de build

Execute no **PowerShell como Administrador**:

```powershell
# 1. Instalar Python (se não tiver)
winget install Python.Python.3.12

# 2. Baixar e instalar VS Build Tools com C++
$url = "https://aka.ms/vs/17/release/vs_buildtools.exe"
$out = "$env:TEMP\vs_buildtools.exe"
Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing
Start-Process $out -ArgumentList "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended" -Wait
```

> Após instalar, **feche e reabra o terminal** antes de continuar.

### Linux / macOS

```bash
# Ubuntu/Debian
sudo apt install python3 build-essential

# macOS (Xcode Command Line Tools)
xcode-select --install
```

---

## Instalação

```bash
# 1. Entre na pasta do projeto
cd whatsapp-cardapio

# 2. Instale as dependências (inclui compilação de módulos nativos)
npm install

# 3. Copie e configure o arquivo de ambiente
cp .env.example .env
```

Edite o `.env` com seus valores:

```env
PORT=3000
ADMIN_PASSWORD=suasenha_segura
JWT_SECRET=string_aleatoria_longa_aqui
MP_ACCESS_TOKEN=APP_USR-...          # Token do Mercado Pago (deixe o padrão se não usar PIX)
MP_WEBHOOK_SECRET=                   # Segredo do webhook MP (opcional)
WEBHOOK_BASE_URL=http://localhost:3000
```

---

## Iniciar o servidor

### Desenvolvimento (terminal aberto)

```bash
npm start
```

O servidor inicia na porta `3000`. Na primeira execução aparece o QR Code no terminal e no painel admin.

### Produção com PM2 (processo persistente)

```bash
# Instalar PM2 globalmente (uma vez só)
npm install -g pm2

# Iniciar o bot
pm2 start npm --name "cardapio-bot" -- start

# Salvar para reiniciar automaticamente com o sistema
pm2 save
pm2 startup   # Siga as instruções exibidas

# Comandos úteis
pm2 logs cardapio-bot     # Ver logs em tempo real
pm2 restart cardapio-bot  # Reiniciar
pm2 stop cardapio-bot     # Parar
pm2 status                # Ver status
```

### Windows — executar no terminal sem PM2

```powershell
# Abra o PowerShell na pasta do projeto e execute:
node src/index.js
```

> Mantenha o terminal aberto. Para rodar em segundo plano no Windows use PM2 ou o Agendador de Tarefas.

---

## Primeira configuração

1. Inicie o servidor (`npm start`)
2. Acesse **http://localhost:3000**
3. Faça login com a senha do `ADMIN_PASSWORD` no `.env`
4. O painel mostra o **QR Code** automaticamente — escaneie com seu WhatsApp:
   - Abra o WhatsApp → **⋮ → Aparelhos conectados → Conectar aparelho**
5. Após conectar, vá em **Configurações** e preencha:
   - Nome do estabelecimento
   - Horário de funcionamento
   - Taxa de entrega e pedido mínimo
   - Número do admin (para receber notificações)
6. Vá em **Cardápio** e cadastre categorias e itens

---

## Configurar Webhook do Mercado Pago (PIX)

Necessário apenas se for aceitar pagamentos PIX.

1. Acesse https://www.mercadopago.com.br/developers/panel
2. Crie uma aplicação → vá em **Webhooks**
3. URL: `https://seudominio.com/webhook/mercadopago`
4. Eventos: marque **Pagamentos**
5. Copie o **segredo** → cole em `MP_WEBHOOK_SECRET` no `.env`
6. Coloque seu token em `MP_ACCESS_TOKEN`
7. Atualize `WEBHOOK_BASE_URL` com a URL pública do servidor

> Em desenvolvimento local use [ngrok](https://ngrok.com): `ngrok http 3000`

---

## Estrutura do projeto

```
whatsapp-cardapio/
├── src/
│   ├── index.js                  # Ponto de entrada
│   ├── bot/
│   │   ├── connection.js         # Conexão Baileys + reconexão automática
│   │   ├── messageRouter.js      # Roteamento de mensagens WhatsApp
│   │   ├── sessionManager.js     # Sessões de conversa em memória
│   │   ├── contactStore.js       # Mapeamento LID → número real
│   │   └── handlers/
│   │       ├── welcomeHandler.js
│   │       ├── menuHandler.js
│   │       ├── addressHandler.js
│   │       └── paymentHandler.js
│   ├── api/
│   │   ├── server.js             # Express + Socket.io
│   │   └── routes/
│   │       ├── auth.js           # Login JWT
│   │       ├── admin.js          # CRUD pedidos, cardápio, settings, stats
│   │       └── webhook.js        # Webhook Mercado Pago
│   ├── database/
│   │   ├── db.js                 # Instância SQLite (better-sqlite3)
│   │   └── schema.sql            # Criação das tabelas
│   └── services/
│       ├── notifier.js           # Socket.io + envio WhatsApp ao cliente/admin
│       └── mercadopago.js        # Criação de pagamento PIX
├── admin/                        # Painel web (HTML/CSS/JS puro)
│   ├── index.html                # Login
│   ├── dashboard.html            # Pedidos + filtro de datas
│   ├── menu.html                 # Gerenciar cardápio
│   └── settings.html             # Configurações
├── sessions/                     # Sessão WhatsApp — NÃO commitar
├── data/                         # Banco SQLite — NÃO commitar
├── .env                          # Variáveis de ambiente — NÃO commitar
└── .env.example                  # Modelo do .env
```

---

## Fluxo do bot (resumo)

```
Cliente manda mensagem
  → messageRouter → sessionManager (estado da conversa)
    → IDLE/ORDER_PLACED  → welcomeHandler (menu principal)
    → BROWSING_*         → menuHandler
    → AWAITING_ADDRESS   → addressHandler
    → PAYMENT_METHOD     → paymentHandler
      → PIX   → cria pedido (awaiting_payment) → aguarda webhook MP
      → Cash  → cria pedido (confirmed) → notifica admin
      → Card  → cria pedido (confirmed) → notifica admin
```

---

## Status dos pedidos

| Status | Descrição | Notifica cliente? |
|--------|-----------|-------------------|
| `awaiting_payment` | Aguardando PIX | Não |
| `confirmed` | Pedido confirmado | ✅ Sim |
| `preparing` | Em preparo | ✅ Sim |
| `out_for_delivery` | Saiu para entrega | ✅ Sim |
| `delivered` | Entregue (solicita avaliação) | ✅ Sim |
| `cancelled` | Cancelado | ✅ Sim |

---

## Observações importantes

### WhatsApp LID (`@lid`)
Versões recentes do WhatsApp usam identificadores internos (LID) no lugar dos números de telefone no `remoteJid`. O bot resolve automaticamente o LID para o número real via `contacts.upsert`. Para pedidos antigos com `@lid`, as mensagens são roteadas corretamente pois o Baileys aceita JIDs `@lid` para envio.

### Sessão WhatsApp
Os arquivos de sessão ficam em `sessions/`. Se o WhatsApp desconectar por logout explícito, o bot apaga a sessão automaticamente e gera novo QR Code.

### Banco de dados
SQLite em `data/cardapio.db`. Criado automaticamente na primeira execução.
