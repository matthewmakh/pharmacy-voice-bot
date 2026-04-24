/**
 * Case-analysis prompt diagnostic — measures the synthesis + verify prompts
 * for a real case without making any Claude calls. Use this to confirm whether
 * a hung /analyze run was hitting rate limits (small prompt, slow API) vs.
 * an oversized prompt (genuinely large payload).
 *
 * Usage:
 *   cd server
 *   npx ts-node diagnose-case.ts <caseId>
 *
 * Example: npx ts-node diagnose-case.ts cmoditg0a000u9vfxruz3co3e
 *
 * Reads from whatever DATABASE_URL is in .env — point at production to inspect
 * the actual stuck case.
 */

import 'dotenv/config';
import prisma from './src/lib/prisma';

const TOKENS_PER_BYTE = 0.25; // rough heuristic for English text

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function approxTokens(bytes: number): number {
  return Math.round(bytes * TOKENS_PER_BYTE);
}

function bar(label: string) {
  console.log(`\n${'─'.repeat(72)}`);
  console.log(`  ${label}`);
  console.log('─'.repeat(72));
}

async function main() {
  const caseId = process.argv[2];
  if (!caseId) {
    console.error('Usage: npx ts-node diagnose-case.ts <caseId>');
    process.exit(1);
  }

  const c = await prisma.case.findUnique({
    where: { id: caseId },
    include: { documents: { orderBy: { uploadedAt: 'asc' } } },
  });

  if (!c) {
    console.error(`Case ${caseId} not found.`);
    process.exit(1);
  }

  bar(`Case ${c.id}`);
  console.log(`status:        ${c.status}`);
  console.log(`title:         ${c.title || '(none)'}`);
  console.log(`amountOwed:    ${c.amountOwed}`);
  console.log(`hasContract:   ${c.hasWrittenContract}`);
  console.log(`createdAt:     ${c.createdAt.toISOString()}`);
  console.log(`docs:          ${c.documents.length}`);

  bar('Per-document extractedFacts size (input to synthesizeCase)');
  let totalFactsBytes = 0;
  let totalKeyStatementsBytes = 0;
  for (const d of c.documents) {
    const factsJson = JSON.stringify(d.extractedFacts || {}, null, 2);
    const factsBytes = Buffer.byteLength(factsJson, 'utf8');
    const ks = (d.extractedFacts as Record<string, unknown> | null)?.keyStatements;
    const ksBytes = Array.isArray(ks)
      ? Buffer.byteLength(JSON.stringify(ks), 'utf8')
      : 0;
    totalFactsBytes += factsBytes;
    totalKeyStatementsBytes += ksBytes;
    const flagged = factsBytes > 8000 ? '  ⚠ large' : '';
    console.log(
      `  ${d.originalName.padEnd(50).slice(0, 50)}  facts=${fmtBytes(factsBytes).padStart(8)}  keyStatements=${fmtBytes(ksBytes).padStart(8)}  status=${
        d.classification ?? 'pending'
      }${flagged}`
    );
  }
  console.log(`  ───`);
  console.log(`  TOTAL facts JSON across all docs: ${fmtBytes(totalFactsBytes)}`);
  console.log(`  of which keyStatements:           ${fmtBytes(totalKeyStatementsBytes)}`);

  // ── Reconstruct the synthesizeCase prompt exactly as services/claude.ts does ──
  const userFacts = {
    claimantName: c.claimantName,
    claimantBusiness: c.claimantBusiness,
    claimantAddress: c.claimantAddress,
    claimantPhone: c.claimantPhone,
    debtorName: c.debtorName,
    debtorBusiness: c.debtorBusiness,
    debtorAddress: c.debtorAddress,
    debtorPhone: c.debtorPhone,
    debtorEntityType: c.debtorEntityType,
    amountOwed: c.amountOwed?.toString(),
    amountPaid: c.amountPaid?.toString(),
    serviceDescription: c.serviceDescription,
    invoiceNumber: c.invoiceNumber,
    hasWrittenContract: c.hasWrittenContract,
    agreementDate: c.agreementDate?.toISOString(),
    invoiceDate: c.invoiceDate?.toISOString(),
    paymentDueDate: c.paymentDueDate?.toISOString(),
    serviceStartDate: c.serviceStartDate?.toISOString(),
    serviceEndDate: c.serviceEndDate?.toISOString(),
    industry: c.industry,
  };

  const docsContext = c.documents
    .map(
      (d, i) =>
        `Document ${i + 1}: ${d.originalName}
Type: ${d.classification || 'unknown'}
Summary: ${d.summary || 'N/A'}
Supports: ${d.supportsTags.join(', ') || 'none identified'}
Facts: ${JSON.stringify(d.extractedFacts || {}, null, 2)}`
    )
    .join('\n\n---\n\n');

  // The actual prompt template length (the "instructions" part) is ~6 KB based on the source.
  const userFactsBlock = JSON.stringify(userFacts, null, 2);
  const docsContextBytes = Buffer.byteLength(docsContext, 'utf8');
  const userFactsBytes = Buffer.byteLength(userFactsBlock, 'utf8');
  const PROMPT_TEMPLATE_OVERHEAD = 6 * 1024; // approximate
  const synthesisPromptBytes =
    PROMPT_TEMPLATE_OVERHEAD + userFactsBytes + docsContextBytes;

  bar('synthesizeCase prompt');
  console.log(`  template overhead:    ${fmtBytes(PROMPT_TEMPLATE_OVERHEAD)}`);
  console.log(`  userFacts JSON:       ${fmtBytes(userFactsBytes)}`);
  console.log(`  docsContext (all):    ${fmtBytes(docsContextBytes)}`);
  console.log(`  ──`);
  console.log(`  TOTAL prompt:         ${fmtBytes(synthesisPromptBytes)}`);
  console.log(`  ≈ tokens:             ${approxTokens(synthesisPromptBytes).toLocaleString()}`);
  console.log(
    `  Sonnet 4.6 ctx:       200,000 input tokens (cap), output cap=12288 tokens after fix`
  );

  // ── Reconstruct the verifyCaseSynthesis prompt envelope ──
  // verify embeds the synthesis OUTPUT (which we don't have until we run it), so we
  // can only estimate. Use 5 KB as a typical synthesis output size.
  const ESTIMATED_SYNTHESIS_OUTPUT_BYTES = 5 * 1024;
  const verifyDocsBlock = JSON.stringify(
    c.documents.map((d) => ({
      classification: d.classification,
      supportsTags: d.supportsTags,
      summary: d.summary,
    })),
    null,
    2
  );
  const verifyPromptBytes =
    PROMPT_TEMPLATE_OVERHEAD +
    Buffer.byteLength(verifyDocsBlock, 'utf8') +
    userFactsBytes +
    ESTIMATED_SYNTHESIS_OUTPUT_BYTES;

  bar('verifyCaseSynthesis prompt (estimate, since synthesis output is variable)');
  console.log(`  template overhead:        ${fmtBytes(PROMPT_TEMPLATE_OVERHEAD)}`);
  console.log(`  userFacts JSON:           ${fmtBytes(userFactsBytes)}`);
  console.log(`  docs (stripped) JSON:     ${fmtBytes(Buffer.byteLength(verifyDocsBlock, 'utf8'))}`);
  console.log(`  synthesis output (est.):  ${fmtBytes(ESTIMATED_SYNTHESIS_OUTPUT_BYTES)}`);
  console.log(`  ──`);
  console.log(`  TOTAL prompt:             ${fmtBytes(verifyPromptBytes)}`);
  console.log(`  ≈ tokens:                 ${approxTokens(verifyPromptBytes).toLocaleString()}`);

  bar('Verdict');
  const synthTokens = approxTokens(synthesisPromptBytes);
  if (synthesisPromptBytes < 30 * 1024) {
    console.log(`  ✓ synthesis prompt is small (${fmtBytes(synthesisPromptBytes)} ≈ ${synthTokens.toLocaleString()} tokens)`);
    console.log(`    A 6+ minute hang on this case is NOT explained by prompt size.`);
    console.log(`    Most likely cause: Anthropic rate-limit retry storm (429/529 from upstream).`);
    console.log(`    Fix: concurrency cap on per-doc analysis (already shipped) + spacing of /analyze.`);
  } else if (synthesisPromptBytes < 80 * 1024) {
    console.log(`  ⚠ synthesis prompt is large (${fmtBytes(synthesisPromptBytes)} ≈ ${synthTokens.toLocaleString()} tokens)`);
    console.log(`    Within Claude's context window but slow to process.`);
    console.log(`    Fix candidates: cap keyStatements length in per-doc analyzeDocument prompt;`);
    console.log(`    truncate extractedFacts in synthesis context build.`);
  } else {
    console.log(`  ✗ synthesis prompt is very large (${fmtBytes(synthesisPromptBytes)} ≈ ${synthTokens.toLocaleString()} tokens)`);
    console.log(`    This is the dominant cause of the hang. Reduce prompt size before retrying.`);
  }

  // Top 3 largest extractedFacts payloads — these are the bloat sources.
  const sortedDocs = [...c.documents].sort(
    (a, b) =>
      Buffer.byteLength(JSON.stringify(b.extractedFacts || {}), 'utf8') -
      Buffer.byteLength(JSON.stringify(a.extractedFacts || {}), 'utf8')
  );
  if (sortedDocs.length > 0) {
    console.log(`\n  Largest extractedFacts payloads (top 3):`);
    for (const d of sortedDocs.slice(0, 3)) {
      const facts = JSON.stringify(d.extractedFacts || {}, null, 2);
      console.log(`    ${d.originalName}: ${fmtBytes(Buffer.byteLength(facts, 'utf8'))}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Diagnostic failed:', err);
  process.exit(1);
});
