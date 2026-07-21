# Local MySQL And Redis

Installed local development services:

```text
MySQL service: MySQL84
MySQL port: 3306
MySQL root password: QkeerRoot@2026
Database: znzh_ydlweb_com
Development user: qkeer_dev
Development password: QkeerDev@2026

Redis service: Redis
Redis port: 6379
Redis password: empty
Redis db: 0
```

Imported schema/data from:

```text
admin/0000-files/sql/znzh_ydlweb_com.sql
```

FastAPI local config:

```text
admin_fastapi/.env
```

Useful commands:

```powershell
Get-Service MySQL84,Redis
Start-Service MySQL84
Start-Service Redis
& "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe" -uqkeer_dev -pQkeerDev@2026 znzh_ydlweb_com
& "C:\Program Files\Redis\redis-cli.exe" ping
```

