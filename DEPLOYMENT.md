# Deploying to AWS EC2

One EC2 instance runs both containers via `docker-compose.yml`:
`frontend` (nginx, serving the built React app and reverse-proxying `/api/*`
to the backend) and `backend` (FastAPI/uvicorn, not exposed to the internet
directly). `chatbot.db` and `faiss_db/` are bind-mounted from the host, so
conversation history and uploaded PDFs survive every redeploy.

GitHub Actions ([.github/workflows/ci-cd.yml](.github/workflows/ci-cd.yml))
type-checks and builds the frontend, syntax-checks the backend, and — only on
a push to `main` once both pass — SSHes into the EC2 box and re-deploys.

## One-time setup

### 1. Launch the instance

- AWS Console → EC2 → Launch instance
- Ubuntu Server 24.04 LTS, `t2.micro`/`t3.micro` (free-tier eligible)
- Create or reuse a key pair, download the `.pem`
- Security group inbound rules: **22** (SSH, ideally restricted to your IP) and **80** (HTTP, `0.0.0.0/0`)

### 2. Install Docker on the instance

```bash
ssh -i your-key.pem ubuntu@<EC2_PUBLIC_IP>
sudo apt update && sudo apt install -y git
curl -fsSL https://get.docker.com -o get-docker.sh && sudo sh get-docker.sh
```

All `docker`/`docker compose` commands below are run with `sudo` — adding
`ubuntu` to the `docker` group only takes effect on a brand-new login session,
which is unreliable in a non-interactive SSH command (like the one GitHub
Actions runs), so `sudo` is simpler and works consistently everywhere.

### 3. Clone the repo and configure secrets

```bash
git clone https://github.com/<you>/<repo>.git ~/agentic-chatbot
cd ~/agentic-chatbot
cp backend/.env.example backend/.env
nano backend/.env   # fill in GEMINI_API_KEY, TAVILY_API_KEY, etc.
```

Set `FRONTEND_URL` in `backend/.env` to `http://<EC2_PUBLIC_IP>` (or your
domain, once you have one). API keys stay in this file, only on the server —
they're never built into the frontend or committed to git.

### 4. First deploy (manual, to confirm it works)

```bash
sudo docker compose up -d --build
```

Visit `http://<EC2_PUBLIC_IP>` — you should see the chat UI. `sudo docker compose logs -f backend` if it doesn't come up.

### 5. Point GitHub Actions at the instance

Repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
|---|---|
| `EC2_HOST` | the instance's public IP or DNS name |
| `EC2_USER` | `ubuntu` |
| `EC2_SSH_KEY` | the full contents of your `.pem` private key |

## After setup

Every push to `main` that passes CI automatically SSHes in, pulls the new
code, and runs `sudo docker compose up -d --build`. No manual steps after that.

To redeploy by hand from your machine: `ssh -i your-key.pem ubuntu@<EC2_PUBLIC_IP>` then repeat step 4.
