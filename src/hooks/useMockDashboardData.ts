import { useMemo } from 'react';

export interface Performer {
  name: string;
  role: string;
  score: number;
  loans: number;
  revenue: number | string;
  trend: 'up' | 'down';
  rank: number;
  tier?: 'top' | 'middle' | 'bottom';
  pullThrough?: string;
}

export interface BranchLO {
  name: string;
  revenue: string;
  loans: number;
  pullThrough: string;
  tier: 'top' | 'middle' | 'bottom';
  score: number;
}

export interface MockDashboardData {
  namePool: string[];
  realTopPerformers: Performer[];
  realMiddlePerformers: Performer[];
  realBottomPerformers: Performer[];
  branchLOs: BranchLO[];
}

/**
 * Generate diverse, realistic name pool and performer data
 * Uses useMemo to ensure names are stable across renders
 */
export const useMockDashboardData = (): MockDashboardData => {
  return useMemo(() => {
    const generateNamePool = () => {
      const firstNames = ['Marcus', 'Priya', 'Derek', 'Sophia', 'Brandon', 'Aisha', 'Tyler', 'Hannah', 'Rafael', 'Megan', 'Vincent', 'Courtney', 'Jamal', 'Elena', 'Christopher', 'Brianna', 'Nathan', 'Jasmine', 'Ethan', 'Olivia', 'Jordan', 'Fatima', 'Trevor', 'Carmen', 'Austin', 'Destiny', 'Blake', 'Yuki', 'Cameron', 'Aaliyah', 'Dylan', 'Samantha', 'Connor', 'Gabriella', 'Ian', 'Melanie', 'Zachary', 'Natasha', 'Joshua', 'Taylor', 'Ricardo', 'Brittany', 'Andre', 'Michelle', 'Gregory', 'Vanessa', 'Keith', 'Jessica', 'Dominic', 'Stephanie', 'Kyle', 'Shaniqua', 'Patrick', 'Rosa', 'Bradley', 'Tameka', 'Scott', 'Lucia', 'Drew', 'Keisha', 'Ryan', 'Diana', 'Chad', 'Monique', 'Seth', 'Alicia', 'Derrick', 'Leila', 'Troy', 'Candace', 'Mitchell', 'Jasmin', 'Corey', 'Tiffany', 'Wesley', 'Renee', 'Brett', 'Latoya', 'Gavin', 'Simone', 'Rodney', 'Denise', 'Craig', 'Veronica', 'Spencer', 'Monica', 'Terrence', 'Heather', 'Reginald', 'Crystal', 'Valentina', 'Benjamin', 'Naomi', 'Lawrence', 'Ingrid', 'Marcus', 'Sarah', 'Michael', 'Emily', 'James', 'Lisa', 'David', 'Jennifer', 'Robert', 'Amanda', 'Chris', 'Nicole', 'Mark', 'Daniel', 'Rachel', 'Kevin', 'Michelle', 'Brian', 'Ashley', 'Justin', 'Stephanie', 'Eric', 'Lauren', 'Jonathan', 'Amanda', 'Ryan', 'Melissa', 'Nicholas', 'Kimberly', 'Jason', 'Michelle', 'Thomas', 'Angela', 'Timothy', 'Brenda', 'Jose', 'Emma', 'William', 'Olivia', 'Alexander', 'Isabella', 'Anthony', 'Sophia', 'David', 'Ava', 'Joseph', 'Mia', 'Charles', 'Emily', 'Daniel', 'Abigail', 'Matthew', 'Madison', 'Mark', 'Elizabeth'];
      const lastNames = ['Wellington', 'Patel', 'Nakamura', 'Reyes', 'Mitchell', 'Johnson', 'Okonkwo', 'Bergstrom', 'Santos', 'O\'Brien', 'Zhao', 'Williams', 'Thompson', 'Kowalski', 'Huang', 'Foster', 'Gupta', 'Rivera', 'Christiansen', 'Yamamoto', 'Blackwell', 'Al-Hassan', 'Lindqvist', 'Delgado', 'Porter', 'Jackson', 'Rasmussen', 'Tanaka', 'Fields', 'Brown', 'Moreno', 'Nguyen', 'O\'Sullivan', 'Cruz', 'Johansson', 'Turner', 'Obi', 'Volkov', 'Hernandez', 'Kim', 'Fernandez', 'Walsh', 'Williams', 'Sato', 'Paulsen', 'Romero', 'Andersson', 'Chung', 'Rossi', 'Okafor', 'Morrison', 'Davis', 'O\'Malley', 'Gutierrez', 'Stone', 'Robinson', 'Nielsen', 'Mendoza', 'Campbell', 'Harris', 'Petersen', 'Castellanos', 'Larsen', 'Baptiste', 'Magnusson', 'Vazquez', 'Hayes', 'Amini', 'Jensen', 'Freeman', 'Burke', 'Ortega', 'Sullivan', 'Washington', 'Olsen', 'Dominguez', 'Hoffman', 'Carter', 'Murray', 'Beaumont', 'Fischer', 'Ramos', 'Lindberg', 'Silva', 'Collins', 'Espinoza', 'Boyd', 'Jacobsen', 'Watts', 'Duarte', 'Rossi', 'Kowalczyk', 'Takahashi', 'Fitzgerald', 'Johansson', 'Oyelaran', 'Martinez', 'Chen', 'Rodriguez', 'Wilson', 'Anderson', 'Kim', 'Brown', 'Taylor', 'White', 'Johnson', 'Davis', 'Thompson', 'Miller', 'Garcia', 'Martinez', 'Rodriguez', 'Lewis', 'Lee', 'Walker', 'Hall', 'Allen', 'Young', 'King', 'Wright', 'Lopez', 'Hill', 'Scott', 'Green', 'Adams', 'Baker', 'Gonzalez', 'Nelson', 'Carter', 'Mitchell', 'Perez', 'Roberts', 'Turner', 'Phillips', 'Campbell', 'Parker', 'Evans', 'Edwards', 'Collins', 'Stewart', 'Sanchez', 'Morris', 'Rogers', 'Reed', 'Cook', 'Morgan', 'Bell', 'Murphy', 'Bailey', 'Rivera', 'Cooper', 'Richardson', 'Cox', 'Howard', 'Ward', 'Torres', 'Peterson', 'Gray', 'Ramirez', 'James'];

      // Create all combinations and shuffle
      const allNames: string[] = [];
      for (let i = 0; i < firstNames.length; i++) {
        for (let j = 0; j < lastNames.length; j++) {
          allNames.push(`${firstNames[i]} ${lastNames[j]}`);
        }
      }

      // Shuffle using Fisher-Yates algorithm
      for (let i = allNames.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allNames[i], allNames[j]] = [allNames[j], allNames[i]];
      }
      return allNames;
    };

    const pool = generateNamePool();
    let idx = 0;
    const getNext = () => pool[idx++ % pool.length];

    // Real data for the 6 key reports - All tiers (representing 100 employees)
    const top: Performer[] = [
      { name: getNext(), role: 'LO', score: 94, loans: 28, revenue: 1250000, trend: 'up', rank: 1 },
      { name: getNext(), role: 'Processor', score: 91, loans: 45, revenue: 980000, trend: 'up', rank: 2 },
      { name: getNext(), role: 'UW', score: 89, loans: 32, revenue: 1120000, trend: 'up', rank: 3 },
      { name: getNext(), role: 'Closer', score: 87, loans: 38, revenue: 1050000, trend: 'up', rank: 4 },
      { name: getNext(), role: 'LO', score: 85, loans: 24, revenue: 890000, trend: 'up', rank: 5 },
      { name: getNext(), role: 'Processor', score: 83, loans: 40, revenue: 870000, trend: 'up', rank: 6 },
      { name: getNext(), role: 'UW', score: 81, loans: 26, revenue: 840000, trend: 'up', rank: 7 },
      { name: getNext(), role: 'LO', score: 79, loans: 22, revenue: 820000, trend: 'up', rank: 8 },
      { name: getNext(), role: 'Closer', score: 77, loans: 35, revenue: 800000, trend: 'up', rank: 9 },
      { name: getNext(), role: 'LO', score: 75, loans: 20, revenue: 780000, trend: 'up', rank: 10 },
      { name: getNext(), role: 'Processor', score: 74, loans: 38, revenue: 760000, trend: 'up', rank: 11 },
      { name: getNext(), role: 'UW', score: 73, loans: 24, revenue: 740000, trend: 'up', rank: 12 },
      { name: getNext(), role: 'LO', score: 72, loans: 19, revenue: 720000, trend: 'up', rank: 13 },
      { name: getNext(), role: 'Closer', score: 71, loans: 33, revenue: 700000, trend: 'up', rank: 14 },
      { name: getNext(), role: 'Processor', score: 70, loans: 36, revenue: 680000, trend: 'up', rank: 15 },
      { name: getNext(), role: 'LO', score: 69, loans: 18, revenue: 660000, trend: 'up', rank: 16 },
      { name: getNext(), role: 'UW', score: 68, loans: 23, revenue: 640000, trend: 'up', rank: 17 },
      { name: getNext(), role: 'Closer', score: 67, loans: 31, revenue: 620000, trend: 'up', rank: 18 },
      { name: getNext(), role: 'Processor', score: 66, loans: 34, revenue: 600000, trend: 'up', rank: 19 },
      { name: getNext(), role: 'LO', score: 65, loans: 17, revenue: 580000, trend: 'up', rank: 20 },
    ];

    const middle: Performer[] = [
      { name: getNext(), role: 'LO', score: 64, loans: 18, revenue: 560000, trend: 'up', rank: 21 },
      { name: getNext(), role: 'Processor', score: 63, loans: 28, revenue: 540000, trend: 'down', rank: 22 },
      { name: getNext(), role: 'UW', score: 62, loans: 20, revenue: 520000, trend: 'up', rank: 23 },
      { name: getNext(), role: 'Closer', score: 61, loans: 30, revenue: 500000, trend: 'up', rank: 24 },
      { name: getNext(), role: 'LO', score: 60, loans: 16, revenue: 480000, trend: 'down', rank: 25 },
      { name: getNext(), role: 'Processor', score: 59, loans: 26, revenue: 460000, trend: 'up', rank: 26 },
      { name: getNext(), role: 'UW', score: 58, loans: 19, revenue: 440000, trend: 'up', rank: 27 },
      { name: getNext(), role: 'Closer', score: 57, loans: 28, revenue: 420000, trend: 'down', rank: 28 },
      { name: getNext(), role: 'LO', score: 56, loans: 15, revenue: 400000, trend: 'up', rank: 29 },
      { name: getNext(), role: 'Processor', score: 55, loans: 24, revenue: 380000, trend: 'up', rank: 30 },
      { name: getNext(), role: 'UW', score: 54, loans: 18, revenue: 360000, trend: 'down', rank: 31 },
      { name: getNext(), role: 'Closer', score: 53, loans: 26, revenue: 340000, trend: 'up', rank: 32 },
      { name: getNext(), role: 'LO', score: 52, loans: 14, revenue: 320000, trend: 'up', rank: 33 },
      { name: getNext(), role: 'Processor', score: 51, loans: 22, revenue: 300000, trend: 'down', rank: 34 },
      { name: getNext(), role: 'UW', score: 50, loans: 17, revenue: 280000, trend: 'up', rank: 35 },
      { name: getNext(), role: 'Closer', score: 49, loans: 24, revenue: 260000, trend: 'up', rank: 36 },
      { name: getNext(), role: 'LO', score: 48, loans: 13, revenue: 240000, trend: 'down', rank: 37 },
      { name: getNext(), role: 'Processor', score: 47, loans: 20, revenue: 220000, trend: 'up', rank: 38 },
      { name: getNext(), role: 'UW', score: 46, loans: 16, revenue: 200000, trend: 'up', rank: 39 },
      { name: getNext(), role: 'Closer', score: 45, loans: 22, revenue: 190000, trend: 'down', rank: 40 },
      { name: getNext(), role: 'LO', score: 44, loans: 12, revenue: 180000, trend: 'up', rank: 41 },
      { name: getNext(), role: 'Processor', score: 43, loans: 18, revenue: 170000, trend: 'up', rank: 42 },
      { name: getNext(), role: 'UW', score: 42, loans: 15, revenue: 160000, trend: 'down', rank: 43 },
      { name: getNext(), role: 'Closer', score: 41, loans: 20, revenue: 150000, trend: 'up', rank: 44 },
      { name: getNext(), role: 'LO', score: 40, loans: 11, revenue: 145000, trend: 'down', rank: 45 },
      { name: getNext(), role: 'Processor', score: 39, loans: 16, revenue: 140000, trend: 'up', rank: 46 },
      { name: getNext(), role: 'UW', score: 38, loans: 14, revenue: 135000, trend: 'down', rank: 47 },
      { name: getNext(), role: 'Closer', score: 37, loans: 18, revenue: 130000, trend: 'up', rank: 48 },
      { name: getNext(), role: 'LO', score: 36, loans: 10, revenue: 125000, trend: 'down', rank: 49 },
      { name: getNext(), role: 'Processor', score: 35, loans: 14, revenue: 120000, trend: 'up', rank: 50 },
    ];

    const bottom: Performer[] = [
      { name: getNext(), role: 'UW', score: 34, loans: 13, revenue: 115000, trend: 'down', rank: 51 },
      { name: getNext(), role: 'Closer', score: 33, loans: 16, revenue: 110000, trend: 'down', rank: 52 },
      { name: getNext(), role: 'LO', score: 32, loans: 9, revenue: 105000, trend: 'down', rank: 53 },
      { name: getNext(), role: 'Processor', score: 31, loans: 12, revenue: 100000, trend: 'down', rank: 54 },
      { name: getNext(), role: 'UW', score: 30, loans: 11, revenue: 98000, trend: 'down', rank: 55 },
      { name: getNext(), role: 'Closer', score: 29, loans: 14, revenue: 96000, trend: 'down', rank: 56 },
      { name: getNext(), role: 'LO', score: 28, loans: 8, revenue: 94000, trend: 'down', rank: 57 },
      { name: getNext(), role: 'Processor', score: 27, loans: 10, revenue: 92000, trend: 'down', rank: 58 },
      { name: getNext(), role: 'UW', score: 26, loans: 9, revenue: 90000, trend: 'down', rank: 59 },
      { name: getNext(), role: 'Closer', score: 25, loans: 12, revenue: 88000, trend: 'down', rank: 60 },
      { name: getNext(), role: 'LO', score: 24, loans: 7, revenue: 86000, trend: 'down', rank: 61 },
      { name: getNext(), role: 'Processor', score: 23, loans: 8, revenue: 84000, trend: 'down', rank: 62 },
      { name: getNext(), role: 'UW', score: 22, loans: 7, revenue: 82000, trend: 'down', rank: 63 },
      { name: getNext(), role: 'Closer', score: 21, loans: 10, revenue: 80000, trend: 'down', rank: 64 },
      { name: getNext(), role: 'LO', score: 20, loans: 6, revenue: 78000, trend: 'down', rank: 65 },
      { name: getNext(), role: 'Processor', score: 19, loans: 6, revenue: 76000, trend: 'down', rank: 66 },
      { name: getNext(), role: 'UW', score: 18, loans: 5, revenue: 74000, trend: 'down', rank: 67 },
      { name: getNext(), role: 'Closer', score: 17, loans: 8, revenue: 72000, trend: 'down', rank: 68 },
      { name: getNext(), role: 'LO', score: 16, loans: 5, revenue: 70000, trend: 'down', rank: 69 },
      { name: getNext(), role: 'Processor', score: 15, loans: 4, revenue: 68000, trend: 'down', rank: 70 },
      { name: getNext(), role: 'UW', score: 14, loans: 4, revenue: 66000, trend: 'down', rank: 71 },
      { name: getNext(), role: 'Closer', score: 13, loans: 6, revenue: 64000, trend: 'down', rank: 72 },
      { name: getNext(), role: 'LO', score: 12, loans: 4, revenue: 62000, trend: 'down', rank: 73 },
      { name: getNext(), role: 'Processor', score: 11, loans: 2, revenue: 60000, trend: 'down', rank: 74 },
      { name: getNext(), role: 'UW', score: 10, loans: 2, revenue: 58000, trend: 'down', rank: 75 },
      { name: getNext(), role: 'Closer', score: 9, loans: 4, revenue: 56000, trend: 'down', rank: 76 },
      { name: getNext(), role: 'LO', score: 8, loans: 3, revenue: 54000, trend: 'down', rank: 77 },
      { name: getNext(), role: 'Processor', score: 7, loans: 1, revenue: 52000, trend: 'down', rank: 78 },
      { name: getNext(), role: 'UW', score: 6, loans: 1, revenue: 50000, trend: 'down', rank: 79 },
      { name: getNext(), role: 'Closer', score: 5, loans: 2, revenue: 48000, trend: 'down', rank: 80 },
      { name: getNext(), role: 'LO', score: 4, loans: 2, revenue: 46000, trend: 'down', rank: 81 },
      { name: getNext(), role: 'Processor', score: 3, loans: 0, revenue: 44000, trend: 'down', rank: 82 },
      { name: getNext(), role: 'UW', score: 2, loans: 0, revenue: 42000, trend: 'down', rank: 83 },
      { name: getNext(), role: 'Closer', score: 1, loans: 0, revenue: 40000, trend: 'down', rank: 84 },
      { name: getNext(), role: 'LO', score: 85, loans: 25, revenue: 920000, trend: 'up', rank: 85 },
      { name: getNext(), role: 'Processor', score: 84, loans: 42, revenue: 900000, trend: 'up', rank: 86 },
      { name: getNext(), role: 'UW', score: 83, loans: 28, revenue: 880000, trend: 'up', rank: 87 },
      { name: getNext(), role: 'Closer', score: 82, loans: 36, revenue: 860000, trend: 'up', rank: 88 },
      { name: getNext(), role: 'LO', score: 81, loans: 23, revenue: 840000, trend: 'up', rank: 89 },
      { name: getNext(), role: 'Processor', score: 80, loans: 38, revenue: 820000, trend: 'up', rank: 90 },
      { name: getNext(), role: 'UW', score: 79, loans: 26, revenue: 800000, trend: 'up', rank: 91 },
      { name: getNext(), role: 'Closer', score: 78, loans: 34, revenue: 780000, trend: 'up', rank: 92 },
      { name: getNext(), role: 'LO', score: 77, loans: 21, revenue: 760000, trend: 'up', rank: 93 },
      { name: getNext(), role: 'Processor', score: 76, loans: 36, revenue: 740000, trend: 'up', rank: 94 },
      { name: getNext(), role: 'UW', score: 75, loans: 24, revenue: 720000, trend: 'up', rank: 95 },
      { name: getNext(), role: 'Closer', score: 74, loans: 32, revenue: 700000, trend: 'up', rank: 96 },
      { name: getNext(), role: 'LO', score: 73, loans: 19, revenue: 680000, trend: 'up', rank: 97 },
      { name: getNext(), role: 'Processor', score: 72, loans: 34, revenue: 660000, trend: 'up', rank: 98 },
      { name: getNext(), role: 'UW', score: 71, loans: 22, revenue: 640000, trend: 'up', rank: 99 },
      { name: getNext(), role: 'Closer', score: 70, loans: 30, revenue: 620000, trend: 'up', rank: 100 },
    ];

    // Branch LO data for TopTiering modal
    const branchLOs: BranchLO[] = [
      { name: getNext(), revenue: '$285K', loans: 12, pullThrough: '82%', tier: 'top' as const, score: 92 },
      { name: getNext(), revenue: '$260K', loans: 11, pullThrough: '79%', tier: 'top' as const, score: 89 },
      { name: getNext(), revenue: '$242K', loans: 10, pullThrough: '75%', tier: 'top' as const, score: 86 },
      { name: getNext(), revenue: '$228K', loans: 9, pullThrough: '72%', tier: 'top' as const, score: 83 },
      { name: getNext(), revenue: '$195K', loans: 8, pullThrough: '70%', tier: 'middle' as const, score: 75 },
      { name: getNext(), revenue: '$178K', loans: 7, pullThrough: '68%', tier: 'middle' as const, score: 70 },
      { name: getNext(), revenue: '$162K', loans: 6, pullThrough: '67%', tier: 'middle' as const, score: 65 },
      { name: getNext(), revenue: '$149K', loans: 6, pullThrough: '66%', tier: 'middle' as const, score: 62 },
      { name: getNext(), revenue: '$135K', loans: 5, pullThrough: '64%', tier: 'bottom' as const, score: 58 },
      { name: getNext(), revenue: '$132K', loans: 5, pullThrough: '65%', tier: 'bottom' as const, score: 55 },
    ];

    return {
      namePool: pool,
      realTopPerformers: top,
      realMiddlePerformers: middle,
      realBottomPerformers: bottom,
      branchLOs,
    };
  }, []); // Empty dependency array - generate once on mount
};

