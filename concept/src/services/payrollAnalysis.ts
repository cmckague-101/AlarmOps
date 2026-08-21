export type PayrollAnalysis = {
  totalHours: number;
  confidence: number;
  source: 'prototype';
  note: string;
};

export async function analyzePayrollForm(_imageUri: string): Promise<PayrollAnalysis> {
  await new Promise(resolve => setTimeout(resolve, 900));
  return {
    totalHours: 80,
    confidence: 0.92,
    source: 'prototype',
    note: 'Prototype estimate. Connect the secure payroll vision service before production use.',
  };
}
