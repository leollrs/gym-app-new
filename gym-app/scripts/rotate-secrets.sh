#!/usr/bin/env bash
# rotate-secrets.sh
# Removes .env.local from git tracking and prints instructions
# for rotating compromised credentials.
#
# Usage: bash scripts/rotate-secrets.sh

set -euo pipefail

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo ""
echo -e "${RED}${BOLD}=== SECURITY: Credential Rotation Required ===${NC}"
echo ""

# ---------------------------------------------------------------
# Step 1 — Remove .env.local from git tracking
# ---------------------------------------------------------------
echo -e "${BOLD}Step 1: Remove .env.local from git index${NC}"

if git ls-files --error-unmatch .env.local >/dev/null 2>&1; then
  git rm --cached .env.local
  echo -e "${GREEN}.env.local has been removed from git tracking.${NC}"
  echo "   (The file still exists on disk — only the index entry was removed.)"
else
  echo -e "${GREEN}.env.local is not currently tracked by git. Nothing to remove.${NC}"
fi

echo ""

# ---------------------------------------------------------------
# Step 2 — Verify .gitignore
# ---------------------------------------------------------------
echo -e "${BOLD}Step 2: Verify .gitignore${NC}"

if grep -qx '.env.local' .gitignore 2>/dev/null; then
  echo -e "${GREEN}.env.local is already listed in .gitignore.${NC}"
else
  echo ".env.local" >> .gitignore
  echo -e "${GREEN}Added .env.local to .gitignore.${NC}"
fi

echo ""

# ---------------------------------------------------------------
# Step 3 — Instructions to rotate Supabase credentials
# ---------------------------------------------------------------
echo -e "${BOLD}Step 3: Rotate Supabase credentials${NC}"
echo ""
echo "  1. Go to https://supabase.com/dashboard → select your project."
echo "  2. Navigate to Settings > API."
echo "  3. Click 'Generate new anon key' to rotate VITE_SUPABASE_ANON_KEY."
echo "  4. Copy the new anon key and the project URL."
echo "  5. If you use a service_role key anywhere, rotate that too"
echo "     (Settings > API > service_role)."
echo "  6. Update .env.local with the new values:"
echo ""
echo "       VITE_SUPABASE_URL=<your-project-url>"
echo "       VITE_SUPABASE_ANON_KEY=<new-anon-key>"
echo ""

# ---------------------------------------------------------------
# Step 4 — Instructions to rotate PostHog credentials
# ---------------------------------------------------------------
echo -e "${BOLD}Step 4: Rotate PostHog API key${NC}"
echo ""
echo "  1. Go to https://app.posthog.com → your project."
echo "  2. Navigate to Settings > Project > Project API Key."
echo "  3. Click 'Rotate key' (or delete the old key and create a new one)."
echo "  4. Update .env.local with the new value:"
echo ""
echo "       VITE_POSTHOG_KEY=<new-api-key>"
echo "       VITE_POSTHOG_HOST=<your-posthog-host>"
echo ""

# ---------------------------------------------------------------
# Step 5 — Scrub secrets from git history
# ---------------------------------------------------------------
echo -e "${RED}${BOLD}Step 5: Scrub .env.local from git history${NC}"
echo ""
echo -e "${YELLOW}  WARNING: The credentials are still present in past commits.${NC}"
echo -e "${YELLOW}  Anyone with access to this repo can recover them from history.${NC}"
echo ""
echo "  To fully remove .env.local from all git history, run:"
echo ""
echo "    git filter-repo --invert-paths --path .env.local"
echo ""
echo "  This rewrites history and requires a force-push to all remotes."
echo "  Coordinate with your team before running this command."
echo ""
echo "  Install git-filter-repo if needed:"
echo "    brew install git-filter-repo          # macOS"
echo "    pip install git-filter-repo           # any platform"
echo ""
echo "  After rewriting history, all collaborators must re-clone the repo."
echo ""

# ---------------------------------------------------------------
# Step 6 — Commit the removal
# ---------------------------------------------------------------
echo -e "${BOLD}Step 6: Commit the change${NC}"
echo ""
echo "  When ready, commit the index removal:"
echo ""
echo "    git add .gitignore"
echo "    git commit -m 'security: remove .env.local from git tracking'"
echo ""
echo -e "${GREEN}${BOLD}Done. Do NOT push until you have rotated all keys above.${NC}"
echo ""
