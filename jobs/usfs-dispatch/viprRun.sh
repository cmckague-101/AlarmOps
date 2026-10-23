   (
     cd /home/ryan/fireco || exit 1

     VENV="$HOME/.local/share/fireops/usfs-venv"
     python3 -m venv "$VENV" || exit 1
     "$VENV/bin/pip" install -r jobs/usfs-dispatch/requirements.txt || exit 1

     read -rsp "Supabase Postgres session connection URL: " SUPABASE_DB_URL
     echo
     export SUPABASE_DB_URL

     read -rp "Monitored contact email: " CONTACT
     export FS_USER_AGENT="FireOps/1.0 ($CONTACT)"
     export FS_REQUEST_INTERVAL=3
     export PYTHONUNBUFFERED=1

     while true; do
       next_run=$(( $(date +%s) + 86400 ))
       printf '\n=== VIPR sync started: %s ===\n' "$(date)"

       "$VENV/bin/python" jobs/usfs-dispatch/sync_supabase.py \
         --weekly --fresh-pdfs --cleanup --retention-days 30

       result=$?
       printf '\n=== Finished: exit code %s; %s ===\n' "$result" "$(date)"
       printf 'Next run: %s\n' "$(date -d "@$next_run")"

       delay=$(( next_run - $(date +%s) ))
       sleep "$(( delay > 0 ? delay : 60 ))"
     done
   )
