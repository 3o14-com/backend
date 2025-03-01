# 3o14

## Deploying the backend

### Environment Variables

#### Basic Settings

- PORT (Optional)
    Specifies the port the application will listen on. Default is 3000.

- DATABASE_URL
    The connection string for the PostgreSQL database, formatted as:
    `postgresql://username:password@host/database_name`

- SECRET_KEY
    A secret key used for session security. Generate one using:
    `openssl rand -base64 32`

- BEHIND_PROXY (Optional)
    Enables trust for reverse proxy headers like X-Forwarded-For. Set to true if running behind a load balancer. Disabled by default.

#### Additional Features

- REMOTE_ACTOR_FETCH_POSTS (Optional)
    Determines how many recent public posts are fetched when a remote user is first discovered. Default is 10.

- TIMELINE_INBOXES (Optional)
    If enabled (true), posts visible in the timeline are physically stored in the database instead of being filtered in real-time. Useful for large instances. Default is false.

#### Logging & Debugging

- LOG_LEVEL (Optional)
    Controls the log level. Options include debug, info, warning, error, and fatal. Default is info.

#### Media & Asset Storage

- DRIVE_DISK
    Determines where media files (avatars, images, etc.) are stored. Options:
        fs → Uses local filesystem storage.
        s3 → Uses S3-compatible object storage.
        Default is s3.

##### Local Storage Settings (For fs)

- FS_ASSET_PATH (Required if using fs)
    The directory where media files are stored. Example: /var/lib/hollo.
        Must exist and be writable.
        Recommended permissions: 755 for folders, 644 for files.
        Ensure sufficient storage space and create backups.

#### S3 Storage Settings (For s3)

These are required if using S3 storage:

- ASSET_URL_BASE
  - Public URL where assets are served from
  - Must be publicly accessible for proper functionality.
  - HTTPS is required for production.

- S3_REGION
    The region of the S3-compatible storage, e.g., us-east-1. Some non-AWS services may not require this.

- S3_BUCKET
    The name of the S3 storage bucket, e.g., hollo.

- S3_ENDPOINT_URL
    The base URL for the S3 storage, e.g., <https://s3.us-east-1.amazonaws.com>.

- S3_FORCE_PATH_STYLE (Optional)
    If true, forces path-style URLs instead of virtual-hosted URLs. Useful for non-AWS S3-compatible services. Default is false.

- AWS_ACCESS_KEY_ID & AWS_SECRET_ACCESS_KEY
    Credentials for accessing the S3 bucket. Required for S3 storage.

### Deploying Using Docker

1. Clone this repo

```bash
git clone https://github.com/3o14-com/backend.git
```

2. Setup the environment variables
Read more about environment variables on [Environment Variables](#environment-variables) section.
make a `.env` file and add the following entries

- SECRET_KEY=secret_key generate using `openssl rand -base64 32`
- LOG_LEVEL=info
- BEHIND_PROXY=true

3. Configure `compose.yaml`
if you want to use the local filesystem for media storage then copy `compose-fs.yaml` to `compose.yaml`
and if you want to use S3 storage then copy `compose-minio.yaml` to `compose.yaml`.
Then change the entry for ASSET_URL_BASE to `<your base address>/assets/`.

4. Setup your proxys
If you are using a custom domain, configure your reverse proxy to forward requests to the backend container.

5. Run the docker container
Then run the docker container

```bash
docker compose --env-file .env up
```
