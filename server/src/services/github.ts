/**
 * GitHub integration: ελάχιστος client για το REST API του GitHub και οι καθαρές
 * συναρτήσεις που αποφασίζουν διαδρομές αρχείων.
 *
 * Χωρίς εξωτερική βιβλιοθήκη (Octokit): χρειαζόμαστε περίπου δέκα κλήσεις και το fetch
 * του Node 22 αρκεί. Τα αρχεία γράφονται με το Git Data API (tree → commit → ref) ώστε
 * όλες οι μεταφράσεις μιας γλώσσας να μπαίνουν σε ΕΝΑ commit, όχι ένα ανά αρχείο.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/* ── Κρυπτογράφηση του token ───────────────────────────────────────────────── */

/**
 * Κλειδί AES-256 για τα tokens. Το GITHUB_TOKEN_KEY είναι προαιρετικό: χωρίς αυτό,
 * το κλειδί παράγεται από το JWT_SECRET, ώστε να μη χρειάζεται νέα μεταβλητή στο Railway.
 * Αλλαγή οποιουδήποτε από τα δύο σημαίνει ότι τα αποθηκευμένα tokens πρέπει να ξαναδοθούν.
 */
function tokenKey(): Buffer {
  const secret = process.env.GITHUB_TOKEN_KEY ?? `${process.env.JWT_SECRET ?? ''}:github-token`;
  return createHash('sha256').update(secret).digest();
}

export function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', tokenKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64')).join('.');
}

export function decryptToken(stored: string): string {
  const [iv, tag, encrypted] = stored.split('.').map((part) => Buffer.from(part, 'base64'));
  if (!iv || !tag || !encrypted) throw new GithubError('Το αποθηκευμένο token είναι κατεστραμμένο', 500);
  try {
    const decipher = createDecipheriv('aes-256-gcm', tokenKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    throw new GithubError(
      'Το αποθηκευμένο token δεν αποκρυπτογραφείται (άλλαξε το κλειδί του server;) — δώσε ξανά token',
      409,
    );
  }
}

/* ── Καθαρές συναρτήσεις διαδρομών ─────────────────────────────────────────── */

/** Δέχεται "owner/repo", "owner/repo.git" ή URL του github.com. */
export function parseRepository(input: string): { owner: string; repo: string } | null {
  const cleaned = input
    .trim()
    .replace(/^git@github\.com:/i, '')
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
  const match = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/.exec(cleaned);
  return match ? { owner: match[1]!, repo: match[2]! } : null;
}

/** Ενώνει τμήματα διαδρομής αγνοώντας τα κενά: joinPath("", "a.json") === "a.json". */
export function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join('/');
}

/** Ο φάκελος προορισμού για μια γλώσσα: "locales/{lang}" → "locales/el". */
export function targetDir(template: string, language: string): string {
  return template.replaceAll('{lang}', language);
}

/**
 * Πού μπαίνει μέσα στο project ένα αρχείο του αποθετηρίου, με διαδρομή σχετική με τον
 * φάκελο πηγής. Το Folder του project δεν έχει βάθος στο UI, οπότε όλη η διαδρομή του
 * υποφακέλου γίνεται ένα όνομα φακέλου: "ui/menus/main.json" → φάκελος "ui/menus".
 */
export function placeInProject(relativePath: string): { folderName: string | null; fileName: string } {
  const index = relativePath.lastIndexOf('/');
  if (index < 0) return { folderName: null, fileName: relativePath };
  return { folderName: relativePath.slice(0, index), fileName: relativePath.slice(index + 1) };
}

/** Ένα branch ανά γλώσσα: η επόμενη αποστολή ενημερώνει το ίδιο ανοιχτό PR. */
export function translationBranch(language: string): string {
  return `metafrasis/translations-${language}`;
}

/* ── REST client ───────────────────────────────────────────────────────────── */

export class GithubError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = 'GithubError';
    this.status = status;
  }
}

/** Υπερκαλύπτεται για GitHub Enterprise Server (π.χ. https://github.example.com/api/v3). */
const API = (process.env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/+$/, '');

/** Τα σφάλματα του GitHub σε μηνύματα που καταλαβαίνει ένας διαχειριστής. */
function describeFailure(status: number, body: { message?: string } | null, what: string): string {
  if (status === 401) return 'Το GitHub απέρριψε το token — έληξε ή ανακλήθηκε';
  if (status === 403 && body?.message?.toLowerCase().includes('rate limit')) {
    return 'Ξεπεράστηκε το όριο αιτημάτων του GitHub — δοκίμασε ξανά σε λίγο';
  }
  if (status === 403) return `Το token δεν έχει δικαίωμα για: ${what}`;
  if (status === 404) return `Δεν βρέθηκε στο GitHub: ${what}`;
  return `Σφάλμα GitHub (${status}) σε: ${what}${body?.message ? ` — ${body.message}` : ''}`;
}

export class GithubClient {
  constructor(
    private readonly token: string,
    readonly owner: string,
    readonly repo: string,
  ) {}

  private async request<T>(
    method: string,
    path: string,
    what: string,
    body?: unknown,
    allowStatus: number[] = [],
  ): Promise<{ status: number; data: T }> {
    let res: Response;
    try {
      res = await fetch(`${API}${path}`, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'metafrasis',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new GithubError('Δεν ήταν δυνατή η σύνδεση με το GitHub');
    }

    const data = (await res.json().catch(() => null)) as T;
    if (!res.ok && !allowStatus.includes(res.status)) {
      // 401/403/404 είναι θέμα ρύθμισης, όχι βλάβη του server — 400 για να το δει ο χρήστης.
      const status = [401, 403, 404, 422].includes(res.status) ? 400 : 502;
      throw new GithubError(describeFailure(res.status, data as { message?: string }, what), status);
    }
    return { status: res.status, data };
  }

  private get base(): string {
    return `/repos/${this.owner}/${this.repo}`;
  }

  /** Ελέγχει πρόσβαση στο αποθετήριο· canPush από τα δικαιώματα του token. */
  async getRepository(): Promise<{ fullName: string; defaultBranch: string; canPush: boolean }> {
    const { data } = await this.request<{
      full_name: string;
      default_branch: string;
      permissions?: { push?: boolean };
    }>('GET', this.base, `αποθετήριο ${this.owner}/${this.repo}`);
    return {
      fullName: data.full_name,
      defaultBranch: data.default_branch,
      canPush: data.permissions?.push ?? false,
    };
  }

  /** Το commit στην κορυφή ενός branch, ή null αν το branch δεν υπάρχει. */
  async branchHead(branch: string): Promise<string | null> {
    const { status, data } = await this.request<{ object?: { sha: string } }>(
      'GET',
      `${this.base}/git/ref/heads/${encodePath(branch)}`,
      `branch ${branch}`,
      undefined,
      [404],
    );
    return status === 404 ? null : (data.object?.sha ?? null);
  }

  /** Όλα τα .json αρχεία κάτω από έναν φάκελο, με διαδρομή σχετική με αυτόν. */
  async listJsonFiles(commitSha: string, dir: string): Promise<Array<{ path: string; sha: string }>> {
    const { data } = await this.request<{
      truncated: boolean;
      tree: Array<{ path: string; type: string; sha: string }>;
    }>('GET', `${this.base}/git/trees/${commitSha}?recursive=1`, 'λίστα αρχείων');

    if (data.truncated) {
      throw new GithubError(
        'Το αποθετήριο είναι πολύ μεγάλο για ανάγνωση σε ένα αίτημα — όρισε πιο συγκεκριμένο φάκελο πηγής',
        400,
      );
    }

    const prefix = dir ? `${dir}/` : '';
    return data.tree
      .filter((entry) => entry.type === 'blob' && entry.path.startsWith(prefix))
      .filter((entry) => entry.path.toLowerCase().endsWith('.json'))
      .map((entry) => ({ path: entry.path.slice(prefix.length), sha: entry.sha }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async readBlob(sha: string): Promise<Buffer> {
    const { data } = await this.request<{ content: string; encoding: string }>(
      'GET',
      `${this.base}/git/blobs/${sha}`,
      'περιεχόμενο αρχείου',
    );
    return Buffer.from(data.content, data.encoding === 'base64' ? 'base64' : 'utf8');
  }

  /**
   * Γράφει αρχεία σε ένα branch με ένα commit. Επιστρέφει null αν τα αρχεία ήταν ήδη
   * ίδια (το νέο tree ταυτίζεται με του γονέα) — έτσι δεν γεμίζει το PR κενά commits.
   */
  async commitFiles(params: {
    parentSha: string;
    files: Array<{ path: string; content: string }>;
    message: string;
  }): Promise<string | null> {
    const { data: parent } = await this.request<{ tree: { sha: string } }>(
      'GET',
      `${this.base}/git/commits/${params.parentSha}`,
      'commit βάσης',
    );

    const { data: tree } = await this.request<{ sha: string }>(
      'POST',
      `${this.base}/git/trees`,
      'δημιουργία tree',
      {
        base_tree: parent.tree.sha,
        tree: params.files.map((file) => ({
          path: file.path,
          mode: '100644',
          type: 'blob',
          content: file.content,
        })),
      },
    );
    if (tree.sha === parent.tree.sha) return null;

    const { data: commit } = await this.request<{ sha: string }>(
      'POST',
      `${this.base}/git/commits`,
      'δημιουργία commit',
      { message: params.message, tree: tree.sha, parents: [params.parentSha] },
    );
    return commit.sha;
  }

  /** Δείχνει το branch στο commit, δημιουργώντας το αν χρειάζεται. */
  async setBranch(branch: string, sha: string, exists: boolean): Promise<void> {
    if (exists) {
      await this.request('PATCH', `${this.base}/git/refs/heads/${encodePath(branch)}`, `branch ${branch}`, {
        sha,
        force: true,
      });
    } else {
      await this.request('POST', `${this.base}/git/refs`, `branch ${branch}`, {
        ref: `refs/heads/${branch}`,
        sha,
      });
    }
  }

  async findOpenPull(branch: string, base: string): Promise<{ number: number; url: string } | null> {
    const query = new URLSearchParams({ head: `${this.owner}:${branch}`, base, state: 'open' });
    const { data } = await this.request<Array<{ number: number; html_url: string }>>(
      'GET',
      `${this.base}/pulls?${query}`,
      'Pull Requests',
    );
    const pull = data[0];
    return pull ? { number: pull.number, url: pull.html_url } : null;
  }

  async createPull(params: {
    branch: string;
    base: string;
    title: string;
    body: string;
  }): Promise<{ number: number; url: string }> {
    const { data } = await this.request<{ number: number; html_url: string }>(
      'POST',
      `${this.base}/pulls`,
      'δημιουργία Pull Request',
      { head: params.branch, base: params.base, title: params.title, body: params.body },
    );
    return { number: data.number, url: data.html_url };
  }
}

/** Κωδικοποιεί κάθε τμήμα ξεχωριστά, ώστε οι κάθετοι του branch να μείνουν κάθετοι. */
function encodePath(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/');
}
