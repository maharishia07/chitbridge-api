#!/bin/sh
# Seed E on a SIT box (sit-grund only): a throwaway-named database bm_seede + api container seede-api (loopback :3991), then N demo clients through tools/sim-load.cjs --seed-e.
# ON the box:  sh seed-e.sh up            (database, migrations, api image dir)   |  sh seed-e.sh load 1 30   (clients i..j)   |  sh seed-e.sh api   (start the serving api)   |  sh seed-e.sh trouble [i...]   (W6: the Advice-band trouble, add only, api must be up)
# Mirrors ~/sa3-rig.sh. Never sit-au or sit-in. ADD ONLY: 'up' refuses when the database already exists.
set -eu
W=$HOME/seede; cd $W
DBURL=$(docker exec cbgrund-api-1 printenv DATABASE_URL)
PW=$(docker exec cbgrund-db-1 printenv POSTGRES_PASSWORD)
urlfor() { DBURL="$DBURL" PW="$PW" ADMINU="${2:-}" docker run --rm -e DBURL -e PW -e ADMINU node:22-alpine node -e "const u=new URL(process.env.DBURL);u.pathname='/bm_seede';if(process.env.ADMINU){u.username='postgres';u.password=process.env.PW}console.log(u.toString())"; }
NEW=$(urlfor x); ADMIN=$(urlfor x admin)
case "$1" in
up)
  docker exec cbgrund-db-1 psql -U postgres -d postgres -Atc "select 1 from pg_database where datname='bm_seede'" | grep -q 1 && { echo "bm_seede exists: refusing (add only)"; exit 3; }
  docker exec cbgrund-db-1 psql -U postgres -d postgres -c "CREATE DATABASE bm_seede OWNER cb_app" >/dev/null
  cp $HOME/bmproof/env.txt $W/env.txt
  { cat $W/env.txt; echo "DATABASE_URL=$NEW"; echo "PORT=3991"; echo "NODE_ENV=development"; echo "TESTER_ALL_UNTIL=2026-12-15"; echo "OTP_EMAIL_ENABLED=false"; echo "CB_SIT_BOX=sit-grund"; echo "SOURCE_COMMIT=seede-$(cat $W/HEAD)"; } > $W/env.run; chmod 600 $W/env.run
  docker run --rm --network cbgrund_default --env-file $W/env.run -v $W/api:/w -e ADMIN="$ADMIN" -w /w node:22-alpine sh -c 'apk add -q postgresql16-client >/dev/null 2>&1; node tools/migrate.cjs --db "$ADMIN"' 2>&1 | tail -3 ;;
load)
  for i in $(seq "$2" "$3"); do
    name=$(printf "Seed E Client %03d - demo" "$i"); id=$(printf "seedeh%03d" "$i")
    docker run --rm --network cbgrund_default --env-file $W/env.run -v $W/api:/w -w /w node:22-alpine sh -c "SHOP_CLOCK_ALLOW=1 SEED_MAIL_DOMAIN=test.chitbridge node tools/sim-load.cjs --db '$ADMIN' --api-db '$NEW' --months 17 --history tools/seed/mis-history-seede.json --country AU --shop $id --name '${name% - demo}' --profile grocer --seed-e $i --firm seedefirmau --firm-name 'Seed E Practice - demo'" > $W/out/load-$i.log 2>&1 || echo "client $i exit $?"
    echo "$(date +%T) client $i done" >> $W/out/progress.log
  done ;;
repair)
  shift
  for i in "$@"; do
    id=$(printf "seedeh%03d" "$i")
    docker run --rm --network cbgrund_default --env-file $W/env.run -v $W/api:/w -w /w node:22-alpine sh -c "SHOP_CLOCK_ALLOW=1 SEED_MAIL_DOMAIN=test.chitbridge node tools/sim-load.cjs --db '$ADMIN' --api-db '$NEW' --months 17 --history tools/seed/mis-history-seede.json --country AU --shop $id --name 'Seed E Client' --profile grocer --repair-e --seed-e $i --firm seedefirmau" > $W/out/repair-$i.log 2>&1 || echo "repair $i exit $?"
  done ;;
trouble)
  shift
  docker run --rm --network cbgrund_default --env-file $W/env.run -v $W/api:/w -w /w -e API=http://seede-api:3991 -e SEED_MAIL_DOMAIN=test.chitbridge node:22-alpine node tools/seed/seed-e-trouble.cjs "$@" ;;
api)
  docker rm -f seede-api >/dev/null 2>&1 || true
  docker run -d --name seede-api --restart unless-stopped --network cbgrund_default -p 127.0.0.1:3991:3991 --env-file $W/env.run -v $W/api:/w -w /w node:22-alpine node server.js >/dev/null
  sleep 12; curl -s -o /dev/null -w "health=%{http_code}\n" http://127.0.0.1:3991/health ;;
esac
