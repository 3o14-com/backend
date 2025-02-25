# 3o14

## Steps to run locally withour docker
- run the init db script
- copy these items in .env in the root folder
```plaintext
DATABASE_URL=postgres://postgres:password@localhost:5432/piisuke
SECRET_KEY=PdczTv8EGR5YY3YhOUgs4FZiPbBmNkhCq/eDe5n4v1A=
LOG_LEVEL=info
BEHIND_PROXY=false
DRIVE_DISK=fs
FS_ASSET_PATH=/var/lib/data
```
- run pnpm dev

```bash
git clone https://github.com/3o14-com/backend.git backend
cd backend
./scripts/init_db.sh
pnpm dev
```
