// One-off cleanup for duplicate auto-created "My first project" rows.
//
// Background: a race in getCurrentProject() used to create a fresh
// "My first project" on every page load until one persisted, leaving several
// identical empty projects in the sidebar. The code race is fixed; this script
// clears up the duplicates that were already written to the database.
//
// Safety:
//   - Dry run by default — prints what WOULD be deleted, changes nothing.
//   - Only deletes EMPTY projects (no connected accounts, drafts, or posts).
//   - Always keeps at least one project per organization.
//
// Usage (from the machine/container that has DATABASE_URL set):
//   node scripts/dedupe-projects.mjs            # preview
//   node scripts/dedupe-projects.mjs --apply    # actually delete

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  const projects = await db.project.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      orgId: true,
      name: true,
      createdAt: true,
      _count: { select: { connectedAccounts: true, drafts: true, posts: true } },
    },
  });

  const isEmpty = (p) =>
    p._count.connectedAccounts === 0 &&
    p._count.drafts === 0 &&
    p._count.posts === 0;

  // Group by org.
  const byOrg = new Map();
  for (const p of projects) {
    if (!byOrg.has(p.orgId)) byOrg.set(p.orgId, []);
    byOrg.get(p.orgId).push(p);
  }

  const toDelete = [];
  for (const [orgId, list] of byOrg) {
    if (list.length <= 1) continue; // nothing to dedupe

    const nonEmpty = list.filter((p) => !isEmpty(p));
    const empty = list.filter(isEmpty);

    // Decide which empty rows are safe to delete while keeping >= 1 project.
    let deletable;
    if (nonEmpty.length > 0) {
      // Real projects exist — every empty duplicate can go.
      deletable = empty;
    } else {
      // All empty — keep the earliest (list is createdAt asc), delete the rest.
      deletable = empty.slice(1);
    }

    if (deletable.length) {
      console.log(`\norg ${orgId}: ${list.length} projects, removing ${deletable.length} empty duplicate(s)`);
      for (const p of deletable) {
        console.log(`  - ${p.id}  "${p.name}"  created ${p.createdAt.toISOString()}`);
        toDelete.push(p.id);
      }
    }
  }

  if (toDelete.length === 0) {
    console.log("No duplicate empty projects found. Nothing to do.");
    return;
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — ${toDelete.length} project(s) would be deleted. Re-run with --apply to delete.`);
    return;
  }

  // ProjectSettings/ConnectedAccount/Draft/Post cascade-delete with the project,
  // but these rows are empty by definition, so only the project + its settings go.
  const res = await db.project.deleteMany({ where: { id: { in: toDelete } } });
  console.log(`\nDeleted ${res.count} duplicate project(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
