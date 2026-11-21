-- AlterTable
ALTER TABLE "SourceFile" ADD COLUMN "githubPath" TEXT;

-- CreateTable
CREATE TABLE "GithubLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "baseBranch" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "targetPath" TEXT NOT NULL,
    "tokenCipher" TEXT NOT NULL,
    "tokenHint" TEXT NOT NULL,
    "connectedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastImportAt" TIMESTAMP(3),
    "lastImportSha" TEXT,
    "lastPushAt" TIMESTAMP(3),
    "lastPullUrl" TEXT,

    CONSTRAINT "GithubLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GithubLink_projectId_key" ON "GithubLink"("projectId");

-- AddForeignKey
ALTER TABLE "GithubLink" ADD CONSTRAINT "GithubLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GithubLink" ADD CONSTRAINT "GithubLink_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
