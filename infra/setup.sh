#!/usr/bin/env bash
# Idempotent GCP + GitHub provisioning for Hisaab. Every step checks first and skips what exists.
# Usage: bash infra/setup.sh (the project must already exist with billing enabled)
# PROJECT_ID is a shared umbrella project for personal apps, so every resource here is hisaab-prefixed
# and the WIF pool trusts the whole GitHub owner; each app binds its own repo to its own deployer SA.
# Never changes gcloud's global config: every gcloud call passes --project explicitly.
set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=config.env
source infra/config.env

OWNER=Sumittripathi07 # Case matters: OIDC claims are compared exactly.
REPO=$OWNER/hisaab
P=(--project "$PROJECT_ID")
INSTANCE=hisaab-db
RUN_SA=hisaab-run@$PROJECT_ID.iam.gserviceaccount.com
DEPLOYER_SA=hisaab-deployer@$PROJECT_ID.iam.gserviceaccount.com

skip() { echo "$1: exists, skipping"; }
step() { echo "$1: creating"; }
# IAM is eventually consistent: a just-created service account can briefly be "not found".
retry() { for i in 1 2 3 4 5 6; do "$@" && return; echo "retrying in 10s ($i)"; sleep 10; done; return 1; }

# --- Preflight (read-only). The project is shared by other apps: never create it or change its billing.
die() { echo "ERROR: $*" >&2; exit 1; }
gcloud projects describe "$PROJECT_ID" "${P[@]}" >/dev/null 2>&1 ||
  die "project $PROJECT_ID not found or not accessible; create it in the console first"
[[ $(gcloud billing projects describe "$PROJECT_ID" "${P[@]}" --format='value(billingEnabled)') == True ]] ||
  die "billing is not enabled on $PROJECT_ID; link billing in the console first"
echo "preflight: project $PROJECT_ID exists, billing enabled"

has_version() { [[ -n $(gcloud secrets versions list "$1" --limit=1 --format='value(name)' "${P[@]}") ]]; }
# Owner-managed secrets: Sumit adds these (values never pass through this script or chat). This script only grants
# access to them, so fail early and clearly if one is missing rather than half-way through the IAM steps.
OWNER_SECRETS=(HISAAB_GOOGLE_CLIENT_ID HISAAB_GOOGLE_CLIENT_SECRET HISAAB_SMTP_URL)
for s in "${OWNER_SECRETS[@]}"; do
  has_version "$s" 2>/dev/null ||
    die "secret $s is missing or has no version; add it first (README: Secrets), then re-run"
done
echo "preflight: ${OWNER_SECRETS[*]} exist"

# --- APIs
enabled=$(gcloud services list --enabled "${P[@]}" --format='value(config.name)')
missing=()
for api in run sqladmin artifactregistry secretmanager iam iamcredentials sts cloudresourcemanager; do
  if grep -qx "$api.googleapis.com" <<<"$enabled"; then skip "api $api"; else missing+=("$api.googleapis.com"); fi
done
if ((${#missing[@]})); then step "apis ${missing[*]}"; gcloud services enable "${missing[@]}" "${P[@]}"; fi

# --- Artifact Registry
if gcloud artifacts repositories describe hisaab --location="$REGION" "${P[@]}" >/dev/null 2>&1; then skip "artifact repo hisaab"
else step "artifact repo hisaab"; gcloud artifacts repositories create hisaab --repository-format=docker --location="$REGION" "${P[@]}"; fi

# --- Cloud SQL (creation takes ~10 min; gcloud's own wait blocks without a timeout)
if gcloud sql instances describe "$INSTANCE" "${P[@]}" >/dev/null 2>&1; then skip "sql instance $INSTANCE"
else
  step "sql instance $INSTANCE"
  op=$(gcloud sql instances create "$INSTANCE" --database-version=POSTGRES_16 --edition=ENTERPRISE \
    --tier=db-f1-micro --region="$REGION" --storage-type=SSD --storage-size=10 \
    --backup-start-time=20:30 --enable-point-in-time-recovery --async --format='value(name)' "${P[@]}")
  gcloud sql operations wait "$op" --timeout=unlimited "${P[@]}"
fi

if gcloud sql databases describe hisaab --instance="$INSTANCE" "${P[@]}" >/dev/null 2>&1; then skip "database hisaab"
else step "database hisaab"; gcloud sql databases create hisaab --instance="$INSTANCE" "${P[@]}"; fi

# --- Secrets. A version is only added when the secret has none, so re-runs never rotate.
for s in HISAAB_DATABASE_URL HISAAB_BETTER_AUTH_SECRET; do
  if gcloud secrets describe "$s" "${P[@]}" >/dev/null 2>&1; then skip "secret $s"
  else step "secret $s"; gcloud secrets create "$s" --replication-policy=automatic "${P[@]}"; fi
done

# The SQL user's password and the HISAAB_DATABASE_URL version are always written together from one
# generated value, so they never drift apart. Postgres users can't be created without a password.
# REST with the body on stdin, not gcloud --password, because gcloud logs its arguments to disk.
sql_user() { # METHOD URL-suffix; sends $pw for user hisaab and waits for the operation
  local op
  op=$(printf '{"name":"hisaab","password":"%s"}' "$pw" | curl -fsS -X "$1" --data-binary @- \
    -H "Authorization: Bearer $(gcloud auth print-access-token "${P[@]}")" -H 'Content-Type: application/json' \
    "https://sqladmin.googleapis.com/v1/projects/$PROJECT_ID/instances/$INSTANCE/users$2" | jq -r .name)
  gcloud sql operations wait "$op" "${P[@]}"
}
user_exists() { gcloud sql users list --instance="$INSTANCE" "${P[@]}" --format='value(name)' | grep -qx hisaab; }

if user_exists && has_version HISAAB_DATABASE_URL; then
  skip "sql user hisaab"
  skip "secret HISAAB_DATABASE_URL version"
else
  pw=$(openssl rand -base64 24 | tr -d '/+=')
  if user_exists; then step "sql user hisaab password (HISAAB_DATABASE_URL has no version)"; sql_user PUT '?name=hisaab'
  else step "sql user hisaab"; sql_user POST ''; fi
  step "secret HISAAB_DATABASE_URL version"
  printf 'postgresql://hisaab:%s@localhost/hisaab?host=/cloudsql/%s:%s:%s' "$pw" "$PROJECT_ID" "$REGION" "$INSTANCE" |
    gcloud secrets versions add HISAAB_DATABASE_URL --data-file=- "${P[@]}"
  unset pw
fi

if has_version HISAAB_BETTER_AUTH_SECRET; then skip "secret HISAAB_BETTER_AUTH_SECRET version"
else
  step "secret HISAAB_BETTER_AUTH_SECRET version"
  openssl rand -base64 32 | tr -d '\n' | gcloud secrets versions add HISAAB_BETTER_AUTH_SECRET --data-file=- "${P[@]}"
fi

# --- Service accounts + roles
for sa in hisaab-run hisaab-deployer; do
  if gcloud iam service-accounts describe "$sa@$PROJECT_ID.iam.gserviceaccount.com" "${P[@]}" >/dev/null 2>&1; then skip "service account $sa"
  else step "service account $sa"; gcloud iam service-accounts create "$sa" --display-name="$sa" "${P[@]}"; fi
done

bind() { # "<gcloud group>" resource member role [extra add-binding flags]
  local -a g
  read -ra g <<<"$1"
  if [[ -n $(gcloud "${g[@]}" get-iam-policy "$2" "${P[@]}" --flatten='bindings[].members' \
    --filter="bindings.role=\"$4\" AND bindings.members=\"$3\"" --format='value(bindings.role)' 2>/dev/null) ]]; then skip "$4 on $2 for $3"
  else step "$4 on $2 for $3"; retry gcloud "${g[@]}" add-iam-policy-binding "$2" --member="$3" --role="$4" --format=none "${@:5}" "${P[@]}"; fi
}

# --condition=None keeps the project binding non-interactive even if the shared policy gains conditions.
bind projects "$PROJECT_ID" "serviceAccount:$RUN_SA" roles/cloudsql.client --condition=None
bind projects "$PROJECT_ID" "serviceAccount:$DEPLOYER_SA" roles/run.admin --condition=None
bind projects "$PROJECT_ID" "serviceAccount:$DEPLOYER_SA" roles/artifactregistry.writer --condition=None
# Secret access is per secret, not project-wide: other apps' secrets live in this project too.
bind secrets HISAAB_DATABASE_URL "serviceAccount:$RUN_SA" roles/secretmanager.secretAccessor
bind secrets HISAAB_BETTER_AUTH_SECRET "serviceAccount:$RUN_SA" roles/secretmanager.secretAccessor
for s in "${OWNER_SECRETS[@]}"; do bind secrets "$s" "serviceAccount:$RUN_SA" roles/secretmanager.secretAccessor; done
bind "iam service-accounts" "$RUN_SA" "serviceAccount:$DEPLOYER_SA" roles/iam.serviceAccountUser

# --- Workload Identity Federation for GitHub Actions
if gcloud iam workload-identity-pools describe github --location=global "${P[@]}" >/dev/null 2>&1; then skip "wif pool github"
else step "wif pool github"; gcloud iam workload-identity-pools create github --location=global --display-name=GitHub "${P[@]}"; fi

if gcloud iam workload-identity-pools providers describe github --workload-identity-pool=github --location=global "${P[@]}" >/dev/null 2>&1; then
  skip "wif provider github"
else
  step "wif provider github"
  gcloud iam workload-identity-pools providers create-oidc github --workload-identity-pool=github --location=global \
    --issuer-uri=https://token.actions.githubusercontent.com \
    --attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner \
    --attribute-condition="assertion.repository_owner=='$OWNER'" "${P[@]}"
fi

NUM=$(gcloud projects describe "$PROJECT_ID" "${P[@]}" --format='value(projectNumber)')
POOL=projects/$NUM/locations/global/workloadIdentityPools/github
# Repo-level: only Sumittripathi07/hisaab may impersonate hisaab-deployer.
bind "iam service-accounts" "$DEPLOYER_SA" "principalSet://iam.googleapis.com/$POOL/attribute.repository/$REPO" roles/iam.workloadIdentityUser

# --- GitHub repo variables (non-secret)
setvar() {
  if [[ $(gh variable get "$1" --repo "$REPO" 2>/dev/null) == "$2" ]]; then skip "variable $1"
  else step "variable $1"; gh variable set "$1" --body "$2" --repo "$REPO"; fi
}
setvar GCP_PROJECT_ID "$PROJECT_ID"
setvar GCP_REGION "$REGION"
setvar GCP_WIF_PROVIDER "$POOL/providers/github"
setvar GCP_DEPLOYER_SA "$DEPLOYER_SA"
setvar GCP_RUNTIME_SA "$RUN_SA"
setvar GCP_SQL_INSTANCE "$PROJECT_ID:$REGION:$INSTANCE"

echo "done: $PROJECT_ID"
