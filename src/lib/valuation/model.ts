export type DcfInputs = {
  fcf0: number;
  growthStage1: number;
  years1: number;
  growthTerminal: number;
  wacc: number;
  sharesOutstanding: number;
};

export type DcfOutput = {
  pvCashFlows: number;
  pvTerminalValue: number;
  equityValue: number;
  perShare: number;
};

export function twoStageDcf(inputs: DcfInputs): DcfOutput {
  const { fcf0, growthStage1, years1, growthTerminal, wacc, sharesOutstanding } = inputs;
  if (wacc <= growthTerminal) throw new Error("wacc must exceed growthTerminal");
  let pv = 0;
  let fcf = fcf0;
  for (let y = 1; y <= years1; y++) {
    fcf *= 1 + growthStage1;
    pv += fcf / Math.pow(1 + wacc, y);
  }
  const terminalFcf = fcf * (1 + growthTerminal);
  const terminalValue = terminalFcf / (wacc - growthTerminal);
  const pvTerminal = terminalValue / Math.pow(1 + wacc, years1);
  const equityValue = pv + pvTerminal;
  return {
    pvCashFlows: pv,
    pvTerminalValue: pvTerminal,
    equityValue,
    perShare: sharesOutstanding > 0 ? equityValue / sharesOutstanding : 0,
  };
}

export function compsTarget(fwdEps: number, peFwd: number): number {
  return fwdEps * peFwd;
}

export function blendTargets(
  dcfPerShare: number,
  compsPerShare: number,
  dcfWeight = 0.5
): { target: number; low: number; high: number } {
  const target = dcfPerShare * dcfWeight + compsPerShare * (1 - dcfWeight);
  return {
    target,
    low: Math.min(dcfPerShare, compsPerShare),
    high: Math.max(dcfPerShare, compsPerShare),
  };
}

function linspace(start: number, end: number, steps: number): number[] {
  const arr: number[] = [];
  for (let i = 0; i < steps; i++) {
    arr.push(start + ((end - start) * i) / (steps - 1));
  }
  return arr;
}

export type SensitivityGrid = {
  waccAxis: number[];
  termAxis: number[];
  grid: number[][];
};

export function sensitivityGrid(
  base: DcfInputs,
  waccSteps = [0.07, 0.08, 0.09, 0.10, 0.11, 0.12],
  termSteps = [0.01, 0.015, 0.02, 0.025, 0.03]
): SensitivityGrid {
  const grid = waccSteps.map((w) =>
    termSteps.map((g) => {
      try {
        return twoStageDcf({ ...base, wacc: w, growthTerminal: g }).perShare;
      } catch {
        return 0;
      }
    })
  );
  return { waccAxis: waccSteps, termAxis: termSteps, grid };
}
