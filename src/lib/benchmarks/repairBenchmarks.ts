// Synthetic prototype benchmarks — clearly labeled as per PRD §49
export interface BenchmarkPanel {
  vehicleClass: "economy" | "midsize" | "premium" | "luxury";
  cityTier: "tier1" | "tier2";
  networkStatus: "network" | "non_network";
  labourRatePerHour: number;
  paintCostPerPanel: number;
  replacementIntensityThreshold: number; // % of lines that are "replace"
  partsLabourRatio: number; // expected parts/labour ratio
  estimateIDVRatio: number; // expected estimate/IDV ratio
}

function classifyVehicle(make: string): BenchmarkPanel["vehicleClass"] {
  const premium = ["BMW", "Mercedes", "Audi", "Volvo", "Jaguar", "Lexus"];
  const midsize = ["Honda", "Hyundai", "Toyota", "Kia", "Nissan", "Volkswagen", "Skoda"];
  const luxury = ["BMW", "Mercedes", "Audi", "Porsche", "Land Rover"];
  if (luxury.includes(make)) return "luxury";
  if (premium.includes(make)) return "premium";
  if (midsize.includes(make)) return "midsize";
  return "economy";
}

function classifyCity(city: string): BenchmarkPanel["cityTier"] {
  const tier1 = ["Mumbai", "Delhi", "Bangalore", "Hyderabad", "Pune", "Chennai", "Kolkata"];
  return tier1.includes(city) ? "tier1" : "tier2";
}

export function getBenchmark(make: string, city: string, networkStatus: string): BenchmarkPanel {
  const vc = classifyVehicle(make);
  const ct = classifyCity(city);
  const ns: BenchmarkPanel["networkStatus"] = networkStatus === "network" ? "network" : "non_network";

  // Base rates by vehicle class
  const baseRates: Record<string, { labour: number; paint: number }> = {
    economy: { labour: 450, paint: 2500 },
    midsize: { labour: 550, paint: 3500 },
    premium: { labour: 1200, paint: 8000 },
    luxury: { labour: 1800, paint: 12000 },
  };

  const base = baseRates[vc] || baseRates.midsize;
  const networkMultiplier = ns === "non_network" ? 1.35 : 1.0;
  const tierMultiplier = ct === "tier1" ? 1.1 : 1.0;

  return {
    vehicleClass: vc,
    cityTier: ct,
    networkStatus: ns,
    labourRatePerHour: Math.round(base.labour * networkMultiplier * tierMultiplier),
    paintCostPerPanel: Math.round(base.paint * networkMultiplier * tierMultiplier),
    replacementIntensityThreshold: 70,
    partsLabourRatio: 3.5,
    estimateIDVRatio: 15, // %
  };
}

export function calculateLabourDeviation(labourTotal: number, partsTotal: number, benchmark: BenchmarkPanel): number {
  // Expected labour based on parts/labour ratio
  const expectedLabour = partsTotal / benchmark.partsLabourRatio;
  if (expectedLabour === 0) return 0;
  return ((labourTotal - expectedLabour) / expectedLabour) * 100;
}

export function calculateReplacementIntensity(lineItems: { action: string; category: string }[]): number {
  const partItems = lineItems.filter((li) => li.category === "part");
  if (partItems.length === 0) return 0;
  const replaceItems = partItems.filter((li) => li.action === "replace");
  return (replaceItems.length / partItems.length) * 100;
}
