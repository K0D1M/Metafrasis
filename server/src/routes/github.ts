/**
 * Καρτέλα Integrations → GitHub.
 *
 * Ροή: ο διαχειριστής συνδέει το project με ένα αποθετήριο (token + φάκελοι), εισάγει τα
 * αρχεία JSON πηγής από το baseBranch και στέλνει τις μεταφράσεις πίσω ως Pull Request,
 * ένα branch ανά γλώσσα. Η εισαγωγή περνά από την ίδια διαδρομή με την Ενημέρωση
 * (ingestUpload), οπότε ισχύει ο ίδιος κανόνας: δεν διαγράφεται ποτέ μετάφραση.
 */
import { Router, type Response } from 'express';
import {
  ActivityAction,
  githubLinkSchema,
  githubPushSchema,
  type GithubFileStatus,
  type GithubImportPreview,
  type GithubImportResult,
  type GithubLinkView,
  type GithubPushResult,
} from '@metafrasis/shared';
import type { GithubLink } from '@prisma/client';
import { prisma } from '../db.js';
import { requireProjectRole } from '../auth.js';
import { logActivity } from '../services/activity.js';
import { parseJsonUpload } from '../services/ingest.js';
import { flatten, unflatten, type JsonValue } from '../services/jsonFlatten.js';
import {
  GithubClient,
  GithubError,
  decryptToken,
  encryptToken,
  joinPath,
  parseRepository,
  placeInProject,
  targetDir,
  translationBranch,
} from '../services/github.js';
import { ingestUpload } from './files.js';

export const githubRouter: Router = Router({ mergeParams: true });

/** Μία εισαγωγή ή αποστολή τη φορά ανά project — ένα διπλό κλικ δεν πρέπει να τρέξει δύο. */
const busyProjects = new Set<string>();

function toView(link: GithubLink & { connectedBy: { id: string; username: string } }): GithubLinkView {
  return {
    owner: link.owner,
    repo: link.repo,
    baseBranch: link.baseBranch,
    sourcePath: link.sourcePath,
    targetPath: link.targetPath,
    tokenHint: link.tokenHint,
    connectedBy: link.connectedBy,
    createdAt: link.createdAt.toISOString(),
    lastImportAt: link.lastImportAt?.toISOString() ?? null,
    lastImportSha: link.lastImportSha,
    lastPushAt: link.lastPushAt?.toISOString() ?? null,
    lastPullUrl: link.lastPullUrl,
  };
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof GithubError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  console.error('[metafrasis] GitHub:', error);
  res.status(500).json({ error: 'Σφάλμα διακομιστή' });
}

async function loadLink(projectId: string) {
  return prisma.githubLink.findUnique({
    where: { projectId },
    include: { connectedBy: { select: { id: true, username: true } } },
  });
}

function clientFor(link: GithubLink): GithubClient {
  return new GithubClient(decryptToken(link.tokenCipher), link.owner, link.repo);
}

/** Τρέχει την εργασία κρατώντας το project «απασχολημένο» μέχρι να τελειώσει. */
async function exclusive(projectId: string, res: Response, work: () => Promise<void>): Promise<void> {
  if (busyProjects.has(projectId)) {
    res.status(409).json({ error: 'Τρέχει ήδη συγχρονισμός με το GitHub για αυτό το project' });
    return;
  }
  busyProjects.add(projectId);
  try {
    await work();
  } catch (error) {
    sendError(res, error);
  } finally {
    busyProjects.delete(projectId);
  }
}

/* ── Σύνδεση ───────────────────────────────────────────────────────────────── */

/** Ορατό σε όλα τα μέλη (χωρίς το token) — οι μεταφραστές βλέπουν πού πάει η δουλειά τους. */
githubRouter.get('/', requireProjectRole(), async (req, res) => {
  const projectId = req.params.projectId!;
  const link = await loadLink(projectId);
  res.json({ link: link ? toView(link) : null });
});

githubRouter.put('/', requireProjectRole({ managerOnly: true }), async (req, res) => {
  const parsed = githubLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Μη έγκυρα στοιχεία', fields: parsed.error.flatten().fieldErrors });
    return;
  }
  const input = parsed.data;
  const projectId = req.params.projectId!;

  const repository = parseRepository(input.repository);
  if (!repository) {
    res.status(400).json({
      error: 'Μη έγκυρο αποθετήριο',
      fields: { repository: 'Γράψε owner/repo ή το URL του αποθετηρίου' },
    });
    return;
  }

  const existing = await prisma.githubLink.findUnique({ where: { projectId } });

  try {
    const token = input.token || (existing ? decryptToken(existing.tokenCipher) : '');
    if (!token) {
      res.status(400).json({ error: 'Λείπει το token', fields: { token: 'Απαιτείται token πρόσβασης' } });
      return;
    }

    // Επαλήθευση πριν την αποθήκευση: καλύτερα να το μάθει τώρα ο διαχειριστής παρά στην
    // πρώτη αποστολή, όταν οι μεταφραστές περιμένουν.
    const client = new GithubClient(token, repository.owner, repository.repo);
    const repo = await client.getRepository();
    if (!repo.canPush) {
      res.status(400).json({
        error: 'Το token μπορεί να διαβάσει αλλά όχι να γράψει στο αποθετήριο',
        fields: { token: 'Χρειάζονται δικαιώματα Contents και Pull requests: Read and write' },
      });
      return;
    }
    if (!(await client.branchHead(input.baseBranch))) {
      res.status(400).json({
        error: 'Το branch δεν βρέθηκε',
        fields: { baseBranch: `Δεν υπάρχει branch «${input.baseBranch}» (προεπιλογή: ${repo.defaultBranch})` },
      });
      return;
    }

    const data = {
      owner: repository.owner,
      repo: repository.repo,
      baseBranch: input.baseBranch,
      sourcePath: input.sourcePath,
      targetPath: input.targetPath,
      ...(input.token ? { tokenCipher: encryptToken(token), tokenHint: token.slice(-4) } : {}),
    };

    const link = existing
      ? await prisma.githubLink.update({
          where: { projectId },
          data,
          include: { connectedBy: { select: { id: true, username: true } } },
        })
      : await prisma.githubLink.create({
          data: {
            ...data,
            projectId,
            connectedById: req.userId!,
            tokenCipher: encryptToken(token),
            tokenHint: token.slice(-4),
          },
          include: { connectedBy: { select: { id: true, username: true } } },
        });

    await logActivity({
      projectId,
      userId: req.userId!,
      action: ActivityAction.GITHUB_CONNECT,
      target: `${link.owner}/${link.repo}`,
    });
    res.json({ link: toView(link) });
  } catch (error) {
    sendError(res, error);
  }
});

githubRouter.delete('/', requireProjectRole({ managerOnly: true }), async (req, res) => {
  const projectId = req.params.projectId!;
  const link = await prisma.githubLink.findUnique({ where: { projectId } });
  if (!link) {
    res.status(204).end();
    return;
  }
  // Τα githubPath των αρχείων μένουν: αν ξανασυνδεθεί το ίδιο αποθετήριο, τα αρχεία
  // ξαναβρίσκουν τη θέση τους αντί να εισαχθούν ως διπλότυπα.
  await prisma.githubLink.delete({ where: { projectId } });
  await logActivity({
    projectId,
    userId: req.userId!,
    action: ActivityAction.GITHUB_DISCONNECT,
    target: `${link.owner}/${link.repo}`,
  });
  res.status(204).end();
});

/* ── Εισαγωγή αρχείων πηγής ────────────────────────────────────────────────── */

interface PlannedFile {
  path: string;
  status: GithubFileStatus;
  error?: string;
  content?: JsonValue;
  existingFileId?: string;
}

/**
 * Διαβάζει τα JSON του φακέλου πηγής και τα αντιστοιχίζει σε αρχεία του project: πρώτα
 * με githubPath, μετά με φάκελο + όνομα (ώστε αρχεία που ανέβηκαν χειροκίνητα πριν τη
 * σύνδεση να ενημερώνονται αντί να διπλασιάζονται).
 */
async function planImport(link: GithubLink): Promise<{ commitSha: string; files: PlannedFile[] }> {
  const client = clientFor(link);
  const commitSha = await client.branchHead(link.baseBranch);
  if (!commitSha) throw new GithubError(`Το branch «${link.baseBranch}» δεν υπάρχει πια`, 400);

  const entries = await client.listJsonFiles(commitSha, link.sourcePath);
  if (entries.length === 0) {
    throw new GithubError(
      `Δεν βρέθηκαν αρχεία .json στον φάκελο «${link.sourcePath || '/'}» του ${link.baseBranch}`,
      400,
    );
  }

  const existing = await prisma.sourceFile.findMany({
    where: { projectId: link.projectId },
    select: {
      id: true,
      name: true,
      githubPath: true,
      folder: { select: { name: true } },
      versions: { orderBy: { revision: 'desc' }, take: 1, select: { rawJson: true } },
    },
  });
  const byGithubPath = new Map(existing.filter((f) => f.githubPath).map((f) => [f.githubPath!, f]));
  const byLocalPath = new Map(
    existing
      .filter((f) => !f.githubPath)
      .map((f) => [joinPath(f.folder?.name ?? '', f.name), f]),
  );

  const files: PlannedFile[] = [];
  for (const entry of entries) {
    let content: JsonValue;
    try {
      content = parseJsonUpload(await client.readBlob(entry.sha));
    } catch (error) {
      if (error instanceof GithubError) throw error;
      files.push({ path: entry.path, status: 'invalid', error: (error as Error).message });
      continue;
    }

    const match = byGithubPath.get(entry.path) ?? byLocalPath.get(entry.path);
    if (!match) {
      files.push({ path: entry.path, status: 'new', content });
      continue;
    }
    // Το rawJson αποθηκεύεται ως JSON.stringify(content), οπότε η σύγκριση αγνοεί
    // διαφορές μόνο σε κενά/στοίχιση που δεν αλλάζουν κανένα κείμενο.
    const unchanged = match.versions[0]?.rawJson === JSON.stringify(content);
    files.push({
      path: entry.path,
      status: unchanged ? 'unchanged' : 'changed',
      content,
      existingFileId: match.id,
    });
  }
  return { commitSha, files };
}

githubRouter.get('/import/preview', requireProjectRole({ managerOnly: true }), async (req, res) => {
  const link = await prisma.githubLink.findUnique({ where: { projectId: req.params.projectId! } });
  if (!link) {
    res.status(404).json({ error: 'Το project δεν είναι συνδεδεμένο με GitHub' });
    return;
  }
  try {
    const plan = await planImport(link);
    res.json({
      commitSha: plan.commitSha,
      files: plan.files.map(({ path, status, error }) => ({ path, status, ...(error ? { error } : {}) })),
    } satisfies GithubImportPreview);
  } catch (error) {
    sendError(res, error);
  }
});

githubRouter.post('/import', requireProjectRole({ managerOnly: true }), async (req, res) => {
  const projectId = req.params.projectId!;
  const link = await prisma.githubLink.findUnique({ where: { projectId } });
  if (!link) {
    res.status(404).json({ error: 'Το project δεν είναι συνδεδεμένο με GitHub' });
    return;
  }

  await exclusive(projectId, res, async () => {
    const plan = await planImport(link);
    const result: GithubImportResult = {
      commitSha: plan.commitSha,
      created: 0,
      updated: 0,
      unchanged: 0,
      failed: plan.files
        .filter((f) => f.status === 'invalid')
        .map((f) => ({ path: f.path, error: f.error ?? 'Μη έγκυρο JSON' })),
    };

    const folderIds = new Map<string, string>();
    async function folderIdFor(name: string): Promise<string> {
      const cached = folderIds.get(name);
      if (cached) return cached;
      const folder =
        (await prisma.folder.findFirst({ where: { projectId, parentId: null, name } })) ??
        (await prisma.folder.create({ data: { projectId, name } }));
      folderIds.set(name, folder.id);
      return folder.id;
    }

    for (const file of plan.files) {
      if (file.status === 'invalid' || !file.content) continue;
      if (file.status === 'unchanged') {
        result.unchanged += 1;
        // Αρχείο που ανέβηκε χειροκίνητα και ταίριαξε: από εδώ και πέρα ακολουθεί το GitHub.
        await prisma.sourceFile.update({ where: { id: file.existingFileId! }, data: { githubPath: file.path } });
        continue;
      }

      try {
        const { folderName, fileName } = placeInProject(file.path);
        const { fileId } = await ingestUpload({
          projectId,
          fileId: file.existingFileId ?? null,
          folderId: folderName ? await folderIdFor(folderName) : null,
          name: fileName,
          content: file.content,
          userId: req.userId!,
        });
        await prisma.sourceFile.update({ where: { id: fileId }, data: { githubPath: file.path } });
        if (file.status === 'new') result.created += 1;
        else result.updated += 1;
      } catch (error) {
        result.failed.push({ path: file.path, error: error instanceof Error ? error.message : String(error) });
      }
    }

    await prisma.githubLink.update({
      where: { projectId },
      data: { lastImportAt: new Date(), lastImportSha: plan.commitSha },
    });
    await logActivity({
      projectId,
      userId: req.userId!,
      action: ActivityAction.GITHUB_IMPORT,
      target: `${link.owner}/${link.repo}@${plan.commitSha.slice(0, 7)}`,
    });
    res.json(result);
  });
});

/* ── Αποστολή μεταφράσεων ως Pull Request ──────────────────────────────────── */

githubRouter.post('/push', requireProjectRole({ managerOnly: true }), async (req, res) => {
  const projectId = req.params.projectId!;
  const parsed = githubPushSchema.safeParse(req.body);
  const [link, project] = await Promise.all([
    prisma.githubLink.findUnique({ where: { projectId } }),
    prisma.project.findUnique({ where: { id: projectId } }),
  ]);
  if (!link || !project) {
    res.status(404).json({ error: 'Το project δεν είναι συνδεδεμένο με GitHub' });
    return;
  }
  const language = parsed.success ? parsed.data.language : '';
  if (!(JSON.parse(project.targetLanguages) as string[]).includes(language)) {
    res.status(400).json({ error: 'Η γλώσσα δεν είναι γλώσσα-στόχος του project' });
    return;
  }

  await exclusive(projectId, res, async () => {
    // Μόνο αρχεία που ήρθαν από το GitHub: ένα αρχείο που ανέβηκε χειροκίνητα δεν έχει
    // αντίστοιχο στο αποθετήριο, και δεν πρέπει να εμφανιστεί ξαφνικά μέσα σε ένα PR.
    const files = await prisma.sourceFile.findMany({
      where: { projectId, githubPath: { not: null } },
      orderBy: { name: 'asc' },
      include: {
        versions: { orderBy: { revision: 'desc' }, take: 1 },
        strings: { include: { translations: { where: { language } } } },
      },
    });
    const usable = files.filter((file) => file.versions[0]);
    if (usable.length === 0) {
      res.status(400).json({ error: 'Δεν υπάρχουν αρχεία από το GitHub — κάνε πρώτα εισαγωγή' });
      return;
    }

    // Ίδια ανακατασκευή με το .zip της καρτέλας Μεταφράσεις: η δομή του πρωτοτύπου,
    // και όπου λείπει μετάφραση μένει το πρωτότυπο ώστε το παιχνίδι να φορτώνει πάντα.
    const dir = targetDir(link.targetPath, language);
    const outputs = usable.map((file) => {
      const translations = new Map(
        file.strings.filter((s) => s.translations[0]?.text).map((s) => [s.key, s.translations[0]!.text]),
      );
      const source = JSON.parse(file.versions[0]!.rawJson) as JsonValue;
      const output = unflatten(flatten(source), translations);
      return { path: joinPath(dir, file.githubPath!), content: `${JSON.stringify(output, null, 2)}\n` };
    });

    const client = clientFor(link);
    const baseSha = await client.branchHead(link.baseBranch);
    if (!baseSha) throw new GithubError(`Το branch «${link.baseBranch}» δεν υπάρχει πια`, 400);

    const branch = translationBranch(language);
    const branchSha = await client.branchHead(branch);
    const openPull = branchSha ? await client.findOpenPull(branch, link.baseBranch) : null;

    // Με ανοιχτό PR χτίζουμε πάνω στο branch του (ένα commit ανά αποστολή, ορατό ιστορικό).
    // Χωρίς — π.χ. το προηγούμενο έγινε merge — ξεκινάμε φρέσκο από το baseBranch.
    const parentSha = openPull && branchSha ? branchSha : baseSha;
    const commitSha = await client.commitFiles({
      parentSha,
      files: outputs,
      message: `Ενημέρωση μεταφράσεων (${language}) από το Μετάφρασις\n\nProject: ${project.name}`,
    });

    let pull = openPull;
    if (commitSha) {
      await client.setBranch(branch, commitSha, branchSha !== null);
      pull ??= await client.createPull({
        branch,
        base: link.baseBranch,
        title: `Μεταφράσεις ${language} — ${project.name}`,
        body:
          `Αυτόματη αποστολή από το **Μετάφρασις** για το project «${project.name}».\n\n` +
          `- Γλώσσα: \`${language}\`\n- Αρχεία: ${outputs.length}\n- Φάκελος: \`${dir}\`\n\n` +
          `Τα κείμενα χωρίς μετάφραση κρατούν το πρωτότυπο. Νέες αποστολές ενημερώνουν αυτό το PR.`,
      });
    }

    await prisma.githubLink.update({
      where: { projectId },
      data: { lastPushAt: new Date(), ...(pull ? { lastPullUrl: pull.url } : {}) },
    });
    if (commitSha) {
      await logActivity({
        projectId,
        userId: req.userId!,
        action: ActivityAction.GITHUB_PUSH,
        target: pull ? `${language} → #${pull.number}` : language,
      });
    }

    res.json({
      committed: commitSha !== null,
      fileCount: outputs.length,
      branch,
      pullUrl: pull?.url ?? null,
      pullNumber: pull?.number ?? null,
    } satisfies GithubPushResult);
  });
});
