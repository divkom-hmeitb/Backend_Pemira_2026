-- CreateTable
CREATE TABLE "Voter" (
    "id" TEXT NOT NULL,
    "nim" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "isVoteCakahim" BOOLEAN NOT NULL DEFAULT false,
    "kahimChoice" TEXT,
    "isVoteCasenat" BOOLEAN NOT NULL DEFAULT false,
    "senatorChoice" TEXT,
    "votedDate" TEXT,
    "votedTime" TEXT,
    "cloudinaryUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Voter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Voter_nim_key" ON "Voter"("nim");

-- CreateIndex
CREATE UNIQUE INDEX "Voter_token_key" ON "Voter"("token");
