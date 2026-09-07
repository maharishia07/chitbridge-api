# Two workflows waiting on one permission

`uptime.yml` (the watchdog) and `backup-restore.yml` (the nightly dump that proves itself by restoring) are finished and reviewed.
They sit here rather than in `.github/workflows/` for one reason: the `gh` token on this machine carries `gist, read:org, repo` and
GitHub refuses a push that creates a workflow file without the `workflow` scope. Parking them here keeps them in the repository and in
history instead of holding up every other deploy.

To put them where they belong, once:

```
gh auth refresh -s workflow -h github.com          # sign in as maharishia07, approve
git mv ops/workflows-pending/uptime.yml .github/workflows/uptime.yml
git mv ops/workflows-pending/backup-restore.yml .github/workflows/backup-restore.yml
git commit -m "the watchdog and the nightly restore, in place" && git push
```

`backup-restore.yml` also needs one repository secret before it does anything — `BACKUP_DATABASE_URL`, the Supabase **session
pooler** connection string. The reason for the pooler rather than the direct host is in the file's own header.
