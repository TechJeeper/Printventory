#!/usr/bin/env bash
# =============================================================================
# Printventory — Proxmox VE LXC setup
#
# Run this on a Proxmox VE host to create an unprivileged Debian LXC with
# Docker nesting enabled, then deploy Printventory (server mode) from Docker Hub.
#
# Usage (Proxmox host shell):
#   bash setup-printventory-lxc.sh
#   bash setup-printventory-lxc.sh --ctid 120 --hostname printventory --memory 8192
#   bash setup-printventory-lxc.sh --models /mnt/pve/data/stl:/mnt/models --stl-home /mnt/models
#
# Install into an existing LXC (from the host):
#   bash setup-printventory-lxc.sh --install-only --ctid 120
#
# Or run the install payload inside a Debian/Ubuntu CT that already has nesting:
#   pct push <CTID> setup-printventory-lxc.sh /tmp/setup-printventory-lxc.sh
#   pct exec <CTID> -- bash /tmp/setup-printventory-lxc.sh --guest-install
#
# Defaults target Printventory's Docker guidance: 4 cores, 8 GB RAM, 20 GB disk.
# =============================================================================

set -euo pipefail

APP_NAME="Printventory"
IMAGE_DEFAULT="printventory/printventory:latest"
PORT_DEFAULT="5000"
HOSTNAME_DEFAULT="printventory"
CORES_DEFAULT="4"
MEMORY_DEFAULT="8192"
SWAP_DEFAULT="512"
DISK_DEFAULT="20"
BRIDGE_DEFAULT="vmbr0"
OS_DEFAULT="debian"
OS_VERSION_DEFAULT="13"
INSTALL_DIR="/opt/printventory"
DATA_DIR="${INSTALL_DIR}/data"
MODELS_MOUNT_IN_CT="/mnt/models"

YW=$'\033[33m'
BL=$'\033[36m'
RD=$'\033[01;31m'
GN=$'\033[1;92m'
CL=$'\033[m'
BOLD=$'\033[1m'

CT_ID=""
CT_HOSTNAME="${HOSTNAME_DEFAULT}"
CT_CORES="${CORES_DEFAULT}"
CT_MEMORY="${MEMORY_DEFAULT}"
CT_SWAP="${SWAP_DEFAULT}"
CT_DISK="${DISK_DEFAULT}"
CT_STORAGE=""
CT_TEMPLATE_STORAGE="local"
CT_BRIDGE="${BRIDGE_DEFAULT}"
CT_IP="dhcp"
CT_GATEWAY=""
CT_PASSWORD=""
CT_SSH_KEY=""
CT_ONBOOT="1"
CT_OS="${OS_DEFAULT}"
CT_OS_VERSION="${OS_VERSION_DEFAULT}"
APP_PORT="${PORT_DEFAULT}"
APP_IMAGE="${IMAGE_DEFAULT}"
STL_HOME=""
STL_HOME_EXCLUDE=""
MODELS_BIND=""   # host:path or host:path:ro
PUBLISH_HTTP80="0"
ASSUME_YES="0"
INSTALL_ONLY="0"
GUEST_INSTALL="0"
SKIP_START="0"

msg_info() { echo -e "${BL}[INFO]${CL} $1"; }
msg_ok()   { echo -e "${GN}[OK]${CL}   $1"; }
msg_warn() { echo -e "${YW}[WARN]${CL} $1"; }
msg_error(){ echo -e "${RD}[ERR]${CL}  $1" >&2; }

die() {
  msg_error "$1"
  exit 1
}

header() {
  clear 2>/dev/null || true
  cat <<EOF
${BL}${BOLD}
  ____       _       _                 _
 |  _ \\ _ __(_)_ __ | |_ __   ___ _ __ | |_ ___  _ __ _   _
 | |_) | '__| | '_ \\| __/\\ \\ / / | '_ \\| __/ _ \\| '__| | | |
 |  __/| |  | | | | | |_  \\ V /| | | | | || (_) | |  | |_| |
 |_|   |_|  |_|_| |_|\\__|  \\_/ |_|_| |_|\\__\\___/|_|   \\__, |
                                                      |___/
  Proxmox LXC setup
${CL}
EOF
}

usage() {
  cat <<EOF
${BOLD}${APP_NAME} Proxmox LXC setup${CL}

Creates a Debian LXC on Proxmox VE, installs Docker, and runs Printventory
from Docker Hub (${IMAGE_DEFAULT}).

Options:
  --ctid ID                 Container ID (default: next free)
  --hostname NAME           Hostname (default: ${HOSTNAME_DEFAULT})
  --cores N                 CPU cores (default: ${CORES_DEFAULT})
  --memory MB               RAM in MiB (default: ${MEMORY_DEFAULT}; 4096+ recommended)
  --swap MB                 Swap in MiB (default: ${SWAP_DEFAULT})
  --disk GB                 Root disk size in GiB (default: ${DISK_DEFAULT})
  --storage NAME            Storage for rootfs (default: auto)
  --template-storage NAME   Storage that holds LXC templates (default: local)
  --bridge NAME             Network bridge (default: ${BRIDGE_DEFAULT})
  --ip CIDR|dhcp            IP (default: dhcp). Static example: 192.168.1.50/24
  --gateway IP              Gateway (required with static --ip)
  --password PASS           Root password (default: auto-generated)
  --ssh-key PATH|KEY        SSH public key for root
  --os debian|ubuntu        Guest OS (default: ${OS_DEFAULT})
  --os-version VER          Guest OS version (default: ${OS_VERSION_DEFAULT})
  --port N                  Printventory listen / publish port (default: ${PORT_DEFAULT})
  --image REF               Docker image (default: ${IMAGE_DEFAULT})
  --models HOST[:CT[:ro]]   Bind-mount model library into the CT (and Docker)
                            Example: /mnt/pve/nas/stl  or  /data/stl:/mnt/models:ro
  --stl-home PATH           STL_HOME inside the app container (default: ${MODELS_MOUNT_IN_CT} when --models is set)
  --stl-home-exclude LIST   Optional STL_HOME_EXCLUDE paths (comma-separated)
  --publish-80              Also publish host/CT port 80 (Let's Encrypt HTTP-01)
  --install-only            Skip CT create; install into existing --ctid
  --guest-install           Run install steps inside this guest (no pct)
  --yes                     Non-interactive; accept defaults / provided flags
  --skip-start              Create files but do not start the Docker container
  -h, --help                Show this help

Examples:
  bash setup-printventory-lxc.sh --yes
  bash setup-printventory-lxc.sh --ctid 120 --memory 8192 --models /mnt/models
  bash setup-printventory-lxc.sh --install-only --ctid 120 --models /mnt/nas/stl:/mnt/models
EOF
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] || die "Run as root."
}

is_proxmox_host() {
  command -v pct >/dev/null 2>&1 && command -v pveam >/dev/null 2>&1 && [[ -r /etc/pve ]]
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --ctid) CT_ID="${2:-}"; shift 2 ;;
      --hostname) CT_HOSTNAME="${2:-}"; shift 2 ;;
      --cores) CT_CORES="${2:-}"; shift 2 ;;
      --memory) CT_MEMORY="${2:-}"; shift 2 ;;
      --swap) CT_SWAP="${2:-}"; shift 2 ;;
      --disk) CT_DISK="${2:-}"; shift 2 ;;
      --storage) CT_STORAGE="${2:-}"; shift 2 ;;
      --template-storage) CT_TEMPLATE_STORAGE="${2:-}"; shift 2 ;;
      --bridge) CT_BRIDGE="${2:-}"; shift 2 ;;
      --ip) CT_IP="${2:-}"; shift 2 ;;
      --gateway) CT_GATEWAY="${2:-}"; shift 2 ;;
      --password) CT_PASSWORD="${2:-}"; shift 2 ;;
      --ssh-key) CT_SSH_KEY="${2:-}"; shift 2 ;;
      --os) CT_OS="${2:-}"; shift 2 ;;
      --os-version) CT_OS_VERSION="${2:-}"; shift 2 ;;
      --port) APP_PORT="${2:-}"; shift 2 ;;
      --image) APP_IMAGE="${2:-}"; shift 2 ;;
      --models) MODELS_BIND="${2:-}"; shift 2 ;;
      --stl-home) STL_HOME="${2:-}"; shift 2 ;;
      --stl-home-exclude) STL_HOME_EXCLUDE="${2:-}"; shift 2 ;;
      --publish-80) PUBLISH_HTTP80="1"; shift ;;
      --install-only) INSTALL_ONLY="1"; shift ;;
      --guest-install) GUEST_INSTALL="1"; shift ;;
      --yes|-y) ASSUME_YES="1"; shift ;;
      --skip-start) SKIP_START="1"; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "Unknown option: $1 (use --help)" ;;
    esac
  done
}

prompt_if_needed() {
  [[ "$ASSUME_YES" == "1" || "$GUEST_INSTALL" == "1" ]] && return 0
  echo
  read -r -p "Proceed with ${APP_NAME} LXC setup using current settings? [Y/n] " ans
  case "${ans:-Y}" in
    [Yy]*) ;;
    *) echo "Aborted."; exit 0 ;;
  esac
}

next_ctid() {
  if command -v pvesh >/dev/null 2>&1; then
    pvesh get /cluster/nextid
  else
    local id=100
    while pct status "$id" &>/dev/null; do
      id=$((id + 1))
    done
    echo "$id"
  fi
}

pick_storage() {
  if [[ -n "$CT_STORAGE" ]]; then
    pvesm status -storage "$CT_STORAGE" &>/dev/null || die "Storage not found: $CT_STORAGE"
    echo "$CT_STORAGE"
    return
  fi
  # Prefer common rootdir-capable storages, then first active with content=rootdir.
  local candidate
  local -a rootdir_stores=()
  mapfile -t rootdir_stores < <(pvesm status -content rootdir 2>/dev/null | awk 'NR>1 && $3=="active" {print $1}')
  if ((${#rootdir_stores[@]} > 0)); then
    for candidate in local-lvm local-zfs local; do
      local s
      for s in "${rootdir_stores[@]}"; do
        if [[ "$s" == "$candidate" ]]; then
          echo "$candidate"
          return
        fi
      done
    done
    echo "${rootdir_stores[0]}"
    return
  fi
  die "Could not auto-detect a storage for the LXC rootfs. Pass --storage."
}

find_template() {
  local os="$1" ver="$2" storage="$3"
  local list match
  list="$(pveam list "$storage" 2>/dev/null | awk 'NR>1 {print $1}' | sed "s|^${storage}:vztmpl/||" || true)"
  match="$(grep -E "^${os}-${ver}-standard_.*_amd64\\.tar\\.(zst|gz|xz)$" <<<"$list" | sort -V | tail -n1 || true)"
  if [[ -z "$match" ]]; then
    match="$(grep -E "^${os}-.*-standard_.*_amd64\\.tar\\.(zst|gz|xz)$" <<<"$list" | grep -E "${ver}" | sort -V | tail -n1 || true)"
  fi
  if [[ -z "$match" ]]; then
    msg_info "Downloading ${os} ${ver} LXC template to ${storage}..."
    local available
    available="$(pveam available -section system 2>/dev/null | awk '{print $2}' | grep -E "^${os}-${ver}-standard_.*_amd64\\.tar\\.(zst|gz|xz)$" | sort -V | tail -n1 || true)"
    [[ -n "$available" ]] || die "No ${os}-${ver} amd64 standard template found via pveam."
    pveam download "$storage" "$available"
    match="$available"
  fi
  echo "$match"
}

normalize_models_bind() {
  # Input: host  |  host:ct  |  host:ct:ro
  # Sets MODELS_HOST, MODELS_CT, MODELS_OPTS
  MODELS_HOST=""
  MODELS_CT="${MODELS_MOUNT_IN_CT}"
  MODELS_OPTS="ro"
  [[ -z "$MODELS_BIND" ]] && return 0

  local host ct opts
  IFS=':' read -r host ct opts <<<"$MODELS_BIND"
  [[ -n "$host" ]] || die "Invalid --models value: $MODELS_BIND"
  MODELS_HOST="$host"
  if [[ -n "${ct:-}" ]]; then
    if [[ "$ct" == "ro" || "$ct" == "rw" ]]; then
      MODELS_OPTS="$ct"
    else
      MODELS_CT="$ct"
      [[ -n "${opts:-}" ]] && MODELS_OPTS="$opts"
    fi
  fi
  [[ "$MODELS_OPTS" == "ro" || "$MODELS_OPTS" == "rw" ]] || die "Models mount mode must be ro or rw (got: $MODELS_OPTS)"
  [[ -d "$MODELS_HOST" ]] || die "Models host path does not exist: $MODELS_HOST"
  if [[ -z "$STL_HOME" ]]; then
    STL_HOME="$MODELS_CT"
  fi
}

wait_for_guest_network() {
  local ctid="$1" tries=60
  msg_info "Waiting for guest network..."
  while (( tries > 0 )); do
    if pct exec "$ctid" -- bash -c 'ip -4 -o addr show scope global 2>/dev/null | grep -q inet'; then
      msg_ok "Guest network is up"
      return 0
    fi
    sleep 2
    tries=$((tries - 1))
  done
  msg_warn "Guest has no IPv4 yet; continuing anyway"
}

guest_ip() {
  local ctid="$1"
  pct exec "$ctid" -- bash -c "
    ip -4 -o addr show scope global 2>/dev/null | awk '{print \$4}' | cut -d/ -f1 | head -n1
  " 2>/dev/null || true
}

create_container() {
  local storage template template_ref net_string features
  storage="$(pick_storage)"
  CT_STORAGE="$storage"
  template="$(find_template "$CT_OS" "$CT_OS_VERSION" "$CT_TEMPLATE_STORAGE")"
  template_ref="${CT_TEMPLATE_STORAGE}:vztmpl/${template}"

  [[ -n "$CT_ID" ]] || CT_ID="$(next_ctid)"
  pct status "$CT_ID" &>/dev/null && die "CTID ${CT_ID} already exists. Choose another --ctid or omit it."

  if [[ -z "$CT_PASSWORD" ]]; then
    CT_PASSWORD="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24 || true)"
    [[ -n "$CT_PASSWORD" ]] || CT_PASSWORD="printventory"
  fi

  if [[ "$CT_IP" == "dhcp" ]]; then
    net_string="name=eth0,bridge=${CT_BRIDGE},ip=dhcp"
  else
    [[ -n "$CT_GATEWAY" ]] || die "Static --ip requires --gateway"
    net_string="name=eth0,bridge=${CT_BRIDGE},ip=${CT_IP},gw=${CT_GATEWAY}"
  fi

  # nesting + keyctl: required for Docker in an unprivileged LXC
  features="nesting=1,keyctl=1"

  msg_info "Creating LXC ${CT_ID} (${CT_HOSTNAME}) on ${storage}..."
  local create_args=(
    pct create "$CT_ID" "$template_ref"
    --hostname "$CT_HOSTNAME"
    --cores "$CT_CORES"
    --memory "$CT_MEMORY"
    --swap "$CT_SWAP"
    --rootfs "${storage}:${CT_DISK}"
    --net0 "$net_string"
    --features "$features"
    --unprivileged 1
    --onboot "$CT_ONBOOT"
    --password "$CT_PASSWORD"
    --ostype "$CT_OS"
  )

  if [[ -n "$CT_SSH_KEY" ]]; then
    if [[ -f "$CT_SSH_KEY" ]]; then
      create_args+=(--ssh-public-keys "$CT_SSH_KEY")
    else
      local tmpkey
      tmpkey="$(mktemp)"
      printf '%s\n' "$CT_SSH_KEY" >"$tmpkey"
      create_args+=(--ssh-public-keys "$tmpkey")
      # Cleaned after create below
      SSH_KEY_TMP="$tmpkey"
    fi
  fi

  "${create_args[@]}"
  [[ -n "${SSH_KEY_TMP:-}" ]] && rm -f "$SSH_KEY_TMP"

  # Fuse is useful for some Docker volume/overlay edge cases on older stacks;
  # harmless when unused. AppArmor nesting hint for Docker-in-LXC.
  local conf="/etc/pve/lxc/${CT_ID}.conf"
  if [[ -f "$conf" ]]; then
    grep -q 'lxc.apparmor.profile:' "$conf" || echo "lxc.apparmor.profile: unconfined" >>"$conf"
    grep -q 'lxc.cgroup2.devices.allow: c 10:200 rwm' "$conf" || echo "lxc.cgroup2.devices.allow: c 10:200 rwm" >>"$conf"
    grep -q 'lxc.mount.entry: /dev/fuse' "$conf" || echo "lxc.mount.entry: /dev/fuse dev/fuse none bind,create=file 0 0" >>"$conf"
  fi

  if [[ -n "$MODELS_HOST" ]]; then
    local mp_opts="mp=${MODELS_CT}"
    [[ "$MODELS_OPTS" == "ro" ]] && mp_opts+=",mountoptions=ro" || mp_opts+=",mountoptions=noatime"
    msg_info "Binding models ${MODELS_HOST} -> ${MODELS_CT} (${MODELS_OPTS})"
    pct set "$CT_ID" -mp0 "${MODELS_HOST},${mp_opts}"
  fi

  msg_ok "Created CT ${CT_ID}"
  msg_info "Starting CT ${CT_ID}..."
  pct start "$CT_ID"
  msg_ok "Started CT ${CT_ID}"
  wait_for_guest_network "$CT_ID"

  # Persist credentials note on the host (same idea as community helper scripts).
  cat >"/root/${CT_HOSTNAME}-${CT_ID}.creds" <<EOF
${APP_NAME} LXC
CTID: ${CT_ID}
Hostname: ${CT_HOSTNAME}
Root password: ${CT_PASSWORD}
Created: $(date -Is)
EOF
  chmod 600 "/root/${CT_HOSTNAME}-${CT_ID}.creds"
  msg_ok "Root credentials saved to /root/${CT_HOSTNAME}-${CT_ID}.creds"
}

# ---------------------------------------------------------------------------
# Guest install (Docker + Printventory compose). Runs inside the CT.
# ---------------------------------------------------------------------------
guest_install_printventory() {
  export DEBIAN_FRONTEND=noninteractive

  msg_info "Updating OS packages..."
  apt-get update -y
  apt-get -y dist-upgrade
  apt-get install -y ca-certificates curl gnupg lsb-release
  msg_ok "OS packages updated"

  if ! command -v docker >/dev/null 2>&1; then
    msg_info "Installing Docker Engine + Compose plugin..."
    install -m 0755 -d /etc/apt/keyrings
    local distro_id codename
    distro_id="$(. /etc/os-release && echo "$ID")"
    codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"
    curl -fsSL "https://download.docker.com/linux/${distro_id}/gpg" -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${distro_id} ${codename} stable" \
      >/etc/apt/sources.list.d/docker.list
    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker
    msg_ok "Docker installed"
  else
    msg_ok "Docker already present ($(docker --version))"
    systemctl enable --now docker >/dev/null 2>&1 || true
  fi

  # Docker-in-LXC: avoid iptables/nft surprises; use iptables-legacy when needed.
  if command -v update-alternatives >/dev/null 2>&1; then
    if [[ -x /usr/sbin/iptables-legacy ]]; then
      update-alternatives --set iptables /usr/sbin/iptables-legacy >/dev/null 2>&1 || true
      update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy >/dev/null 2>&1 || true
    fi
  fi

  mkdir -p "$DATA_DIR" "$INSTALL_DIR"
  chmod 755 "$INSTALL_DIR" "$DATA_DIR"

  local models_volume_line="" stl_env_line="" exclude_env_line="" ports_80_line=""
  if [[ -n "${MODELS_CT_EFFECTIVE:-}" ]]; then
    models_volume_line="      - ${MODELS_CT_EFFECTIVE}:${MODELS_CT_EFFECTIVE}:${MODELS_OPTS_EFFECTIVE:-ro}"
  elif [[ -d "$MODELS_MOUNT_IN_CT" ]]; then
    models_volume_line="      - ${MODELS_MOUNT_IN_CT}:${MODELS_MOUNT_IN_CT}:ro"
    MODELS_CT_EFFECTIVE="$MODELS_MOUNT_IN_CT"
  fi

  local stl_value="${STL_HOME:-}"
  if [[ -z "$stl_value" && -n "${MODELS_CT_EFFECTIVE:-}" ]]; then
    stl_value="$MODELS_CT_EFFECTIVE"
  fi
  if [[ -n "$stl_value" ]]; then
    stl_env_line="      - STL_HOME=${stl_value}"
  fi
  if [[ -n "${STL_HOME_EXCLUDE:-}" ]]; then
    exclude_env_line="      - STL_HOME_EXCLUDE=${STL_HOME_EXCLUDE}"
  fi
  if [[ "${PUBLISH_HTTP80}" == "1" ]]; then
    ports_80_line='      - "80:80"'
  fi

  msg_info "Writing ${INSTALL_DIR}/docker-compose.yml"
  cat >"${INSTALL_DIR}/docker-compose.yml" <<EOF
# Generated by setup-printventory-lxc.sh — Printventory server mode
services:
  printventory:
    image: ${APP_IMAGE}
    container_name: printventory-server
    ports:
      - "${APP_PORT}:${APP_PORT}"
${ports_80_line}
    volumes:
      - ${DATA_DIR}:/root/.config/printventory
${models_volume_line}
    environment:
      - DISPLAY=:99
      - PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
      - PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
      - DCONF_DISABLE=1
      - GIO_USE_VFS=local
      - GIO_USE_VOLUME_MONITOR=unix
      - DBUS_FATAL_WARNINGS=0
      - PRINTVENTORY_PORT=${APP_PORT}
      - PRINTVENTORY_PREVIEW_3MF_WORKER_MEMORY_MB=512
      - PRINTVENTORY_PREVIEW_3MF_MAX_FILE_SIZE_MB=200
${stl_env_line}
${exclude_env_line}
    restart: unless-stopped
    mem_limit: 6g
    mem_reservation: 1g
EOF

  # Drop empty optional lines left by unset mounts/env.
  sed -i '/^[[:space:]]*$/d' "${INSTALL_DIR}/docker-compose.yml"

  cat >"${INSTALL_DIR}/update.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd /opt/printventory
docker compose pull
docker compose up -d
docker image prune -f
echo "Printventory updated."
EOF
  chmod +x "${INSTALL_DIR}/update.sh"

  cat >"${INSTALL_DIR}/README.txt" <<EOF
Printventory LXC install
========================
Compose file: ${INSTALL_DIR}/docker-compose.yml
Data (DB/config): ${DATA_DIR}
Update: ${INSTALL_DIR}/update.sh

Useful commands:
  cd ${INSTALL_DIR} && docker compose ps
  docker logs -f printventory-server
  ${INSTALL_DIR}/update.sh

UI: http://<ct-ip>:${APP_PORT}
MCP: http://<ct-ip>:${APP_PORT}/mcp
EOF

  if [[ "$SKIP_START" == "1" ]]; then
    msg_warn "Skipping docker compose up (--skip-start)"
    return 0
  fi

  msg_info "Pulling ${APP_IMAGE} and starting Printventory..."
  cd "$INSTALL_DIR"
  docker compose pull
  docker compose up -d
  msg_ok "Printventory container is running"

  # Lightweight readiness wait (HTTP may take a bit while Electron boots).
  local tries=45
  msg_info "Waiting for HTTP on port ${APP_PORT}..."
  while (( tries > 0 )); do
    if curl -fsS "http://127.0.0.1:${APP_PORT}/" >/dev/null 2>&1 \
      || curl -fsSk "https://127.0.0.1:${APP_PORT}/" >/dev/null 2>&1; then
      msg_ok "Printventory is responding on port ${APP_PORT}"
      return 0
    fi
    sleep 2
    tries=$((tries - 1))
  done
  msg_warn "Container started but HTTP not ready yet. Check: docker logs -f printventory-server"
}

run_guest_install_via_pct() {
  local ctid="$1"
  pct status "$ctid" &>/dev/null || die "CT ${ctid} not found"
  local status
  status="$(pct status "$ctid" | awk '{print $2}')"
  if [[ "$status" != "running" ]]; then
    msg_info "Starting CT ${ctid}..."
    pct start "$ctid"
    wait_for_guest_network "$ctid"
  fi

  # Ensure nesting/keyctl on existing containers when possible.
  local features
  features="$(pct config "$ctid" | awk -F': ' '/^features:/ {print $2}')"
  if [[ "$features" != *nesting=1* || "$features" != *keyctl=1* ]]; then
    msg_info "Enabling nesting=1,keyctl=1 on CT ${ctid} (required for Docker)..."
    pct set "$ctid" --features nesting=1,keyctl=1
    pct reboot "$ctid"
    sleep 3
    wait_for_guest_network "$ctid"
  fi

  if [[ -n "$MODELS_HOST" ]]; then
    if ! pct config "$ctid" | grep -q "mp0:"; then
      local mp_opts="mp=${MODELS_CT}"
      [[ "$MODELS_OPTS" == "ro" ]] && mp_opts+=",mountoptions=ro" || mp_opts+=",mountoptions=noatime"
      pct set "$ctid" -mp0 "${MODELS_HOST},${mp_opts}"
      pct reboot "$ctid"
      sleep 3
      wait_for_guest_network "$ctid"
    fi
  fi

  local self script_in_ct="/tmp/setup-printventory-lxc.sh"
  self="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || realpath "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
  pct push "$ctid" "$self" "$script_in_ct"
  pct exec "$ctid" -- chmod +x "$script_in_ct"

  local guest_args=(--guest-install --yes --port "$APP_PORT" --image "$APP_IMAGE")
  [[ "$PUBLISH_HTTP80" == "1" ]] && guest_args+=(--publish-80)
  [[ "$SKIP_START" == "1" ]] && guest_args+=(--skip-start)
  [[ -n "$STL_HOME" ]] && guest_args+=(--stl-home "$STL_HOME")
  [[ -n "$STL_HOME_EXCLUDE" ]] && guest_args+=(--stl-home-exclude "$STL_HOME_EXCLUDE")
  if [[ -n "$MODELS_CT" && -n "$MODELS_BIND" ]]; then
    # Inside the guest the bind already appears at MODELS_CT; pass a guest-local --models.
    guest_args+=(--models "${MODELS_CT}:${MODELS_CT}:${MODELS_OPTS}")
  fi

  msg_info "Installing ${APP_NAME} inside CT ${ctid}..."
  pct exec "$ctid" -- env \
    MODELS_CT_EFFECTIVE="${MODELS_CT}" \
    MODELS_OPTS_EFFECTIVE="${MODELS_OPTS}" \
    bash "$script_in_ct" "${guest_args[@]}"
  pct exec "$ctid" -- rm -f "$script_in_ct"
  msg_ok "Guest install finished"
}

print_summary() {
  local ip="${1:-}"
  echo
  echo -e "${GN}${BOLD}${APP_NAME} LXC setup complete${CL}"
  if [[ -n "$CT_ID" ]]; then
    echo -e "  CTID:      ${BOLD}${CT_ID}${CL}"
    echo -e "  Hostname:  ${CT_HOSTNAME}"
  fi
  if [[ -n "$ip" ]]; then
    echo -e "  URL:       ${BOLD}http://${ip}:${APP_PORT}${CL}"
    echo -e "  MCP:       http://${ip}:${APP_PORT}/mcp"
  else
    echo -e "  URL:       ${BOLD}http://<ct-ip>:${APP_PORT}${CL}"
  fi
  echo -e "  Data:      ${DATA_DIR} (inside CT)"
  echo -e "  Compose:   ${INSTALL_DIR}/docker-compose.yml"
  echo -e "  Update:    ${INSTALL_DIR}/update.sh"
  if [[ -n "$CT_ID" && -f "/root/${CT_HOSTNAME}-${CT_ID}.creds" ]]; then
    echo -e "  Creds:     /root/${CT_HOSTNAME}-${CT_ID}.creds"
  fi
  echo
  echo -e "${YW}Tips:${CL}"
  echo "  - Mount model libraries with --models /path/on/host (bind-mounted into the CT + Docker)."
  echo "  - Configure HTTPS in the UI: Settings → HTTPS / SSL (use --publish-80 for Let's Encrypt)."
  echo "  - Logs: pct exec ${CT_ID:-<CTID>} -- docker logs -f printventory-server"
  echo
}

main() {
  parse_args "$@"
  require_root
  header

  if [[ "$GUEST_INSTALL" == "1" ]]; then
    # When invoked via pct with --models host:ct:ro rewritten to ct:ct:ro,
    # normalize_models_bind expects a directory that exists inside the guest.
    if [[ -n "$MODELS_BIND" ]]; then
      normalize_models_bind
      MODELS_CT_EFFECTIVE="${MODELS_CT}"
      MODELS_OPTS_EFFECTIVE="${MODELS_OPTS}"
    fi
    guest_install_printventory
    local lip
    lip="$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -n1 || true)"
    print_summary "$lip"
    return 0
  fi

  is_proxmox_host || die "This mode must run on a Proxmox VE host (pct/pveam missing). Use --guest-install inside a CT."

  if [[ "$CT_MEMORY" -lt 4096 ]]; then
    msg_warn "RAM ${CT_MEMORY} MiB is below the 4096 MiB recommendation for scanning/previews."
  fi

  normalize_models_bind
  prompt_if_needed

  if [[ "$INSTALL_ONLY" == "1" ]]; then
    [[ -n "$CT_ID" ]] || die "--install-only requires --ctid"
    run_guest_install_via_pct "$CT_ID"
  else
    create_container
    run_guest_install_via_pct "$CT_ID"
  fi

  local ip
  ip="$(guest_ip "$CT_ID")"
  print_summary "$ip"
}

main "$@"
