/**
 * Δοκιμαστικά δεδομένα, ώστε η εφαρμογή να ανοίγει με πραγματικό περιεχόμενο.
 * Τρέξε: npm run db:seed -w server
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const MANAGER_EMAIL = 'manager@metafrasis.dev';
const TRANSLATOR_EMAIL = 'translator@metafrasis.dev';
const PASSWORD = 'password123';

/** Ίδια λογική με το services/jsonFlatten.ts — εδώ μόνο για τα κείμενα. */
function flattenStrings(node, path = [], out = []) {
  if (typeof node === 'string') {
    out.push({ key: path.join('.'), value: node });
    return out;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      flattenStrings(value, [...path, key], out);
    }
  }
  return out;
}

const chapter1 = {
  meta: { version: 1, episodic: true },
  menu: { start: 'New Game', load: 'Load Game', options: 'Options', quit: 'Quit' },
  chapter1: {
    title: 'The Awakening',
    scenes: [
      { id: 'intro', lines: ['You wake up in a dark room.', 'The air is cold.', 'Something moves.'] },
      { id: 'hallway', lines: ['The hallway stretches ahead.', 'A door creaks open.'] },
    ],
    items: { lantern: 'Rusty Lantern', key: 'Brass Key', note: 'Torn Note' },
  },
};

const chapter2 = {
  meta: { version: 1, episodic: true },
  chapter2: {
    title: 'The Descent',
    scenes: [{ id: 'stairs', lines: ['The stairs spiral downward.', 'You hear water below.'] }],
    items: { rope: 'Frayed Rope', lamp: 'Oil Lamp' },
  },
};

async function main() {
  // Καθαρό ξεκίνημα: το seed είναι επαναλήψιμο.
  await prisma.project.deleteMany({});
  await prisma.user.deleteMany({
    where: { email: { in: [MANAGER_EMAIL, TRANSLATOR_EMAIL] } },
  });

  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

  const manager = await prisma.user.create({
    data: { email: MANAGER_EMAIL, username: 'Κώστας', passwordHash },
  });
  const translator = await prisma.user.create({
    data: { email: TRANSLATOR_EMAIL, username: 'Μαρία', passwordHash },
  });

  const project = await prisma.project.create({
    data: {
      name: 'Το Επεισοδιακό Παιχνίδι',
      sourceLanguage: 'en',
      targetLanguages: JSON.stringify(['el']),
      members: {
        create: [
          { userId: manager.id, role: 'MANAGER' },
          { userId: translator.id, role: 'TRANSLATOR' },
        ],
      },
    },
  });

  const folder = await prisma.folder.create({
    data: { projectId: project.id, name: 'Κεφάλαια' },
  });

  // Μερικές έτοιμες μεταφράσεις, ώστε η μπάρα προόδου να μην είναι στο μηδέν.
  const ready = new Map([
    ['menu.start', 'Νέο παιχνίδι'],
    ['menu.load', 'Φόρτωση'],
    ['menu.options', 'Επιλογές'],
    ['menu.quit', 'Έξοδος'],
    ['chapter1.title', 'Η Αφύπνιση'],
    ['chapter1.scenes.0.lines.0', 'Ξυπνάς σε ένα σκοτεινό δωμάτιο.'],
    ['chapter1.scenes.0.lines.1', 'Ο αέρας είναι παγωμένος.'],
    ['chapter1.items.lantern', 'Σκουριασμένο Φανάρι'],
  ]);

  for (const [name, content] of [
    ['chapter1.json', chapter1],
    ['chapter2.json', chapter2],
  ]) {
    const file = await prisma.sourceFile.create({
      data: { projectId: project.id, folderId: folder.id, name },
    });

    await prisma.fileVersion.create({
      data: {
        fileId: file.id,
        revision: 1,
        uploadedBy: manager.id,
        rawJson: JSON.stringify(content),
      },
    });

    const strings = flattenStrings(content);
    for (const [index, item] of strings.entries()) {
      const created = await prisma.sourceString.create({
        data: { fileId: file.id, key: item.key, sourceText: item.value, order: index },
      });

      const translation = ready.get(item.key);
      if (translation) {
        await prisma.translation.create({
          data: {
            stringId: created.id,
            language: 'el',
            text: translation,
            authorId: translator.id,
          },
        });
      }
    }

    // Μια συζήτηση, για να φαίνεται η λειτουργία σχολίων.
    const first = await prisma.sourceString.findFirst({
      where: { fileId: file.id, key: 'menu.start' },
    });
    if (first) {
      const root = await prisma.comment.create({
        data: {
          stringId: first.id,
          authorId: translator.id,
          body: 'Να το πούμε «Νέο παιχνίδι» ή «Νέα παρτίδα»;',
        },
      });
      await prisma.comment.create({
        data: {
          stringId: first.id,
          authorId: manager.id,
          parentId: root.id,
          body: '«Νέο παιχνίδι» είναι πιο συνηθισμένο στα videogames.',
        },
      });
    }
  }

  // ── Δεδομένα για τις υπόλοιπες καρτέλες ──────────────────────────────────
  const files = await prisma.sourceFile.findMany({ where: { projectId: project.id } });
  const chapter1File = files.find((f) => f.name === 'chapter1.json');

  const task = await prisma.task.create({
    data: {
      projectId: project.id,
      title: 'Μετάφραση του μενού',
      description: 'Ολοκλήρωσε όλα τα κείμενα κάτω από το κλειδί «menu».',
      assigneeId: translator.id,
      createdById: manager.id,
      files: chapter1File ? { create: [{ fileId: chapter1File.id }] } : undefined,
    },
  });

  await prisma.taskComment.create({
    data: {
      taskId: task.id,
      authorId: translator.id,
      body: 'Ξεκίνησα από τα τέσσερα κείμενα του μενού.',
    },
  });

  const menuStart = chapter1File
    ? await prisma.sourceString.findFirst({
        where: { fileId: chapter1File.id, key: 'menu.start' },
      })
    : null;

  await prisma.qaReport.create({
    data: {
      projectId: project.id,
      stringId: menuStart?.id ?? null,
      title: 'Ασυνέπεια στην ορολογία',
      description: 'Σε κάποια σημεία γράφουμε «παιχνίδι» και σε άλλα «παρτίδα». Να επιλέξουμε ένα.',
      severity: 'MEDIUM',
      authorId: translator.id,
    },
  });

  for (const entry of [
    { userId: manager.id, action: 'project.create', target: project.name },
    { userId: manager.id, action: 'folder.create', target: 'Κεφάλαια' },
    { userId: manager.id, action: 'file.upload', target: 'chapter1.json' },
    { userId: manager.id, action: 'file.upload', target: 'chapter2.json' },
    { userId: translator.id, action: 'translation.save', target: 'menu.start' },
    { userId: translator.id, action: 'comment.add', target: 'menu.start' },
    { userId: manager.id, action: 'task.create', target: task.title },
    { userId: translator.id, action: 'qa.create', target: 'Ασυνέπεια στην ορολογία' },
  ]) {
    await prisma.activity.create({ data: { projectId: project.id, ...entry } });
  }

  console.log('Έτοιμο.');
  console.log(`  Διαχειριστής: ${MANAGER_EMAIL} / ${PASSWORD}`);
  console.log(`  Μεταφραστής:  ${TRANSLATOR_EMAIL} / ${PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
