#!/usr/bin/env bash
#
# First-time setup for /srv/spoken. Run ON THE DROPLET, as root, once.
#
#   sudo bash deploy/web/bootstrap.sh
#
# Adds a directory tree, a database and two database roles, the owner and the app's. It
# installs no Node, no pm2, no nginx and no firewall rule, and it touches neither
# /srv/voiceover nor /srv/zonelore -- which keep serving until the cutover and stay whole
# afterwards as the rollback.
#
# It does NOT write shared/app.env. That holds the secrets, one of which has to be copied
# from the zones deployment by hand; deploy/web/README.md has the block to paste.
set -euo pipefail

ROOT=/srv/spoken
DB_USER=spoken
DB_NAME=spoken
APP_USER=spoken_app

id deploy >/dev/null 2>&1 || {
  echo "bootstrap: there is no 'deploy' user. The two existing sites run as one; this uses the same." >&2
  exit 1
}

echo "==> $ROOT"
install -d -o deploy -g deploy -m 755 \
  "$ROOT" "$ROOT/releases" "$ROOT/bin" "$ROOT/shared"

# Everything the app writes, and nothing a release may own.
#
# store.sh replaces most of these with symlinks onto the /mnt/voice volume; they are
# created here so that a droplet without the volume still has somewhere to put things, and
# so the layout is described in one place.
#
#   audio/            the quests store, ~3.1 GB
#   sounds/           the zones masters, ~453 MB
#   audio-history/    what both sections replaced, one directory each
#   voices/           clone clips: an ElevenLabs voice cannot be exported, so these are
#                     the only way to remake one
#   seed-clips/       what those clips are seeded from, per language;
#                     pushed from a workstation (make web-push-seed-clips)
#   audio-previews/   rendered pronunciation previews, each one paid for
#   downloads/        the complete sound pack, served straight off disk by nginx
#
# downloads/ is a directory of its own rather than shared/ itself because nginx aliases it:
# shared/ holds app.env, and aliasing a directory that contains secrets is one chmod away
# from serving them.
install -d -o deploy -g deploy -m 755 \
  "$ROOT/shared/audio" \
  "$ROOT/shared/sounds" \
  "$ROOT/shared/audio-history" \
  "$ROOT/shared/audio-history/quests" \
  "$ROOT/shared/audio-history/places" \
  "$ROOT/shared/voices" \
  "$ROOT/shared/voice-references" \
  "$ROOT/shared/seed-clips" \
  "$ROOT/shared/audio-previews" \
  "$ROOT/shared/downloads"

echo "==> database"
# The role owns the database and nothing else on the cluster. A password is set because the
# app connects over TCP to 127.0.0.1 rather than over the socket as `deploy`.
if ! sudo -u postgres psql -tAc "select 1 from pg_roles where rolname = '$DB_USER'" | grep -q 1; then
  PGPW=$(openssl rand -base64 24)
  sudo -u postgres psql -q -c "create role $DB_USER login password '$PGPW'"
  echo
  echo "    the database password, which goes into $ROOT/shared/app.env:"
  echo "    $PGPW"
  echo
else
  echo "    role $DB_USER already exists; its password is whatever app.env already says"
fi

# The owner reads every team's rows for migrations, backups and pack builds, and the tables force
# row-level security on it, so it needs BYPASSRLS. Only a superuser can grant that; 0090 refuses
# to run without it.
sudo -u postgres psql -q -c "alter role $DB_USER bypassrls"

# The role the app logs in as, which row-level security binds. Made here because making a role
# needs CREATEROLE, which the owner lacks; 0090 grants it what it may touch.
if ! sudo -u postgres psql -tAc "select 1 from pg_roles where rolname = '$APP_USER'" | grep -q 1; then
  APPPW=$(openssl rand -base64 24 | tr -d '/+=')
  sudo -u postgres psql -q -c "create role $APP_USER login password '$APPPW'"
  echo
  echo "    the app's password, for APP_DATABASE_URL in $ROOT/shared/app.env:"
  echo "    $APPPW"
  echo
else
  echo "    role $APP_USER already exists; its password is whatever app.env already says"
fi

if ! sudo -u postgres psql -tAc "select 1 from pg_database where datname = '$DB_NAME'" | grep -q 1; then
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
else
  echo "    database $DB_NAME already exists"
fi

cat <<'NEXT'

==> done. What is left, in order:

  0. Put the stores on the block volume, before anything fills them:
       bash deploy/web/store.sh
     It replaces the directories just created with symlinks into /mnt/voice. The root
     disk has no room for the ~10 GB the cutover copies in.

  1. Write /srv/spoken/shared/app.env (mode 600, owned by deploy).
     deploy/web/README.md has the block. SPOKEN_SECRET_KEY must be copied from
     /srv/zonelore/shared/app.env's ZONELORE_SECRET_KEY, or every stored ElevenLabs
     credential imported at cutover is unopenable.

  2. From your workstation:  make web-deploy-scripts

  3. Restore the quests database, then apply the migrations:
       sudo -u postgres pg_dump voiceover | sudo -u postgres psql spoken
       /srv/spoken/bin/migrate.sh /srv/spoken/current      (after the first deploy)

  4. Get the certificate and install the vhost:
       certbot certonly --nginx -d spoken.rusty.one
       cp deploy/web/nginx-spoken.conf /etc/nginx/sites-available/spoken
       ln -s /etc/nginx/sites-available/spoken /etc/nginx/sites-enabled/
       nginx -t && systemctl reload nginx

  The rest -- the audio, the zones import and the redirects -- is the cutover, and
  deploy/web/README.md runs through it in order.
NEXT
