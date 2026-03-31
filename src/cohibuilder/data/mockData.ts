import { TOLL_BROTHERS_LISTING_IMAGES } from './tollBrothersOfficialMedia';

export const loans = [
  { 
    id: 1, 
    borrower: 'Sarah & Mark Jenkins', 
    lender: 'Toll Brothers Mortgage Company (Captive)', 
    isPreferred: true,
    status: 'Foundation', 
    daysToClose: 145, 
    riskScore: 12,
    riskLevel: 'Low',
    los: 'ICE Encompass',
    erpSync: 'Hyphen BRIX',
    rateLock: { status: 'Locked', expires: '2026-08-15', type: 'LockSolid 345' },
    incentives: { type: 'Closing Credit', value: 15000 },
    sourceType: 'CRM',
    address: '100 West St, Toll Brothers at 100 West',
    city: 'Anaheim',
    state: 'CA',
    lat: 33.8366,
    lng: -117.9143,
    loanAmount: 1000000,
    propertyValue: 1250000,
    isHeloc: true,
    helocData: {
      totalLine: 250000,
      currentBalance: 45000,
      utilization: 18,
      lastDraw: 'Feb 12, 2026',
      nextPayment: 'Apr 01, 2026',
      interestRate: 8.25,
      status: 'Active'
    },
    propertyImage: TOLL_BROTHERS_LISTING_IMAGES[0],
    constructionProgress: 25,
    loanPreparedness: 85,
    milestones: [
      { label: 'Builder Contract Signed', date: 'Jan 10, 2026', completed: true },
      { label: 'Mortgage App Submitted', date: 'Jan 12, 2026', completed: true },
      { label: 'Foundation Poured', date: 'Feb 02, 2026', completed: true },
      { label: 'Framing & Roofing', date: 'In Progress', current: true },
      { label: 'Plumbing & Electrical', date: 'Est. Apr 10', pending: true },
    ],
    preparednessChecklist: [
      { task: 'Income Verification', status: 'Completed' },
      { task: 'Asset Verification', status: 'Completed' },
      { task: 'Credit Refresh', status: 'Pending (Due 30 days before close)' },
      { task: 'Homeowners Insurance', status: 'Not Started' },
      { task: 'Final Inspection', status: 'Pending (Post-Construction)' }
    ]
  },
  { 
    id: 2, 
    borrower: 'David Miller', 
    lender: 'Summit Mortgage', 
    isPreferred: false,
    status: 'Framing', 
    daysToClose: 112, 
    riskScore: 45,
    riskLevel: 'Medium',
    los: 'LendingPad',
    erpSync: 'ECI MarkSystems',
    rateLock: { status: 'Floating', expires: null, type: 'Standard' },
    incentives: { type: 'None', value: 0 },
    sourceType: 'LOS',
    address: '8800 Sienna Springs Blvd, Toll Brothers at Sienna',
    city: 'Missouri City',
    state: 'TX',
    lat: 29.5388,
    lng: -95.5455,
    loanAmount: 760000,
    propertyValue: 950000,
    isHeloc: false,
    isNonQM: false,
    propertyImage: TOLL_BROTHERS_LISTING_IMAGES[1],
    constructionProgress: 40,
    loanPreparedness: 60,
    milestones: [
      { label: 'Builder Contract Signed', date: 'Jan 15, 2026', completed: true },
      { label: 'Mortgage App Submitted', date: 'Jan 25, 2026', completed: true },
      { label: 'Foundation Poured', date: 'Feb 15, 2026', completed: true },
      { label: 'Framing & Roofing', date: 'In Progress', current: true },
      { label: 'Plumbing & Electrical', date: 'Est. May 05', pending: true },
    ],
    preparednessChecklist: [
      { task: 'Income Verification', status: 'Completed' },
      { task: 'Asset Verification', status: 'Pending' },
      { task: 'Credit Refresh', status: 'Pending' },
      { task: 'Homeowners Insurance', status: 'Not Started' },
      { task: 'Final Inspection', status: 'Pending' }
    ]
  },
  { 
    id: 3, 
    borrower: 'Elena Rodriguez', 
    lender: 'Toll Brothers Mortgage Company (Captive)', 
    isPreferred: true,
    status: 'Permitting', 
    daysToClose: 210, 
    riskScore: 82,
    riskLevel: 'High',
    los: 'Byte Pro',
    erpSync: 'Hyphen HomeFront',
    rateLock: { status: 'Locked', expires: '2026-03-28', type: 'LockSolid 345' },
    incentives: { type: 'Design Center Credit', value: 25000 },
    sourceType: 'CRM',
    address: '15920 County Rd 455, Toll Brothers at Bella Collina',
    city: 'Montverde',
    state: 'FL',
    lat: 28.5992,
    lng: -81.6759,
    loanAmount: 1680000,
    propertyValue: 2100000,
    isHeloc: false,
    isNonQM: true,
    nonQMData: {
      type: 'Asset Depletion',
      verifiedAssets: 4200000,
      monthlyIncomeEquivalent: 18500,
      ltv: 65
    },
    propertyImage: TOLL_BROTHERS_LISTING_IMAGES[2],
    constructionProgress: 5,
    loanPreparedness: 45,
    milestones: [
      { label: 'Builder Contract Signed', date: 'Jan 20, 2026', completed: true },
      { label: 'Mortgage App Submitted', date: 'Jan 22, 2026', completed: true },
      { label: 'Permitting & Site Prep', date: 'In Progress', current: true },
      { label: 'Foundation Poured', date: 'Est. Mar 15', pending: true },
      { label: 'Framing & Roofing', date: 'Est. Apr 20', pending: true },
      { label: 'Plumbing & Electrical', date: 'Est. Jun 10', pending: true },
    ],
    preparednessChecklist: [
      { task: 'Income Verification', status: 'Completed' },
      { task: 'Asset Verification', status: 'Completed' },
      { task: 'Credit Refresh', status: 'Pending' },
      { task: 'Homeowners Insurance', status: 'Not Started' },
      { task: 'Final Inspection', status: 'Pending' }
    ]
  },
  { 
    id: 4, 
    borrower: 'The Henderson Family', 
    lender: 'Toll Brothers Mortgage Company (Preferred)', 
    isPreferred: true,
    status: 'Drywall', 
    daysToClose: 45, 
    riskScore: 28,
    riskLevel: 'Low',
    los: 'ICE Encompass',
    sourceType: 'LOS',
    address: '3711 Liseter Rd, Toll Brothers at Liseter',
    city: 'Newtown Square',
    state: 'PA',
    lat: 39.9865,
    lng: -75.4013,
    loanAmount: 1160000,
    propertyValue: 1450000,
    isHeloc: false,
    isNonQM: false,
    propertyImage: TOLL_BROTHERS_LISTING_IMAGES[3],
    constructionProgress: 75,
    loanPreparedness: 90,
    milestones: [
      { label: 'Permitting & Site Prep', date: 'Dec 01, 2025', completed: true },
      { label: 'Foundation Poured', date: 'Dec 20, 2025', completed: true },
      { label: 'Framing & Roofing', date: 'Jan 15, 2026', completed: true },
      { label: 'Drywall & Interior', date: 'In Progress', current: true },
    ],
    preparednessChecklist: [
      { task: 'Income Verification', status: 'Completed' },
      { task: 'Asset Verification', status: 'Completed' },
      { task: 'Credit Refresh', status: 'Completed' },
      { task: 'Homeowners Insurance', status: 'Pending' },
      { task: 'Final Inspection', status: 'Pending' }
    ]
  },
  { 
    id: 5, 
    borrower: 'Robert Chen', 
    lender: 'Summit Mortgage', 
    isPreferred: false,
    status: 'Framing', 
    daysToClose: 98, 
    riskScore: 55,
    riskLevel: 'Medium',
    los: 'Calyx Point',
    sourceType: 'LOS',
    address: '5215 Mesa Park Dr, Toll Brothers at Mesa Ridge',
    city: 'Las Vegas',
    state: 'NV',
    lat: 36.1146,
    lng: -115.3150,
    loanAmount: 1480000,
    propertyValue: 1850000,
    isHeloc: false,
    isNonQM: false,
    propertyImage: TOLL_BROTHERS_LISTING_IMAGES[4],
    constructionProgress: 45,
    loanPreparedness: 70,
    milestones: [
      { label: 'Permitting & Site Prep', date: 'Feb 01, 2026', completed: true },
      { label: 'Foundation Poured', date: 'Feb 20, 2026', completed: true },
      { label: 'Framing & Roofing', date: 'In Progress', current: true },
      { label: 'Plumbing & Electrical', date: 'Est. May 15', pending: true },
    ],
    preparednessChecklist: [
      { task: 'Income Verification', status: 'Completed' },
      { task: 'Asset Verification', status: 'Pending' },
      { task: 'Credit Refresh', status: 'Pending' },
      { task: 'Homeowners Insurance', status: 'Not Started' },
      { task: 'Final Inspection', status: 'Pending' }
    ]
  },
  { 
    id: 6, 
    borrower: 'Michael & Jane Smith', 
    lender: 'Toll Brothers Mortgage Company (Preferred)', 
    isPreferred: true,
    status: 'Foundation', 
    daysToClose: 160, 
    riskScore: 35,
    riskLevel: 'Medium',
    los: 'Blue Sage',
    sourceType: 'LOS',
    address: '11800 S Pikes Peak Dr, Toll Brothers at The Timbers',
    city: 'Parker',
    state: 'CO',
    lat: 39.5186,
    lng: -104.7614,
    loanAmount: 920000,
    propertyValue: 1150000,
    isHeloc: false,
    isNonQM: false,
    propertyImage: TOLL_BROTHERS_LISTING_IMAGES[5],
    constructionProgress: 20,
    loanPreparedness: 55,
    milestones: [
      { label: 'Permitting & Site Prep', date: 'Feb 10, 2026', completed: true },
      { label: 'Foundation Poured', date: 'In Progress', current: true },
      { label: 'Framing & Roofing', date: 'Est. Apr 05', pending: true },
      { label: 'Plumbing & Electrical', date: 'Est. Jun 20', pending: true },
    ],
    preparednessChecklist: [
      { task: 'Income Verification', status: 'Completed' },
      { task: 'Asset Verification', status: 'Pending' },
      { task: 'Credit Refresh', status: 'Pending' },
      { task: 'Homeowners Insurance', status: 'Not Started' },
      { task: 'Final Inspection', status: 'Pending' }
    ]
  },
  { 
    id: 7, 
    borrower: 'Alice Johnson', 
    lender: 'Pioneer Lending', 
    isPreferred: false,
    status: 'Permitting', 
    daysToClose: 225, 
    riskScore: 15,
    riskLevel: 'Low',
    los: 'MeridianLink',
    sourceType: 'LOS',
    address: '12300 132nd Ave NE, Toll Brothers at Rose Hill',
    city: 'Kirkland',
    state: 'WA',
    lat: 47.7110,
    lng: -122.1635,
    loanAmount: 1560000,
    propertyValue: 1950000,
    isHeloc: false,
    isNonQM: false,
    propertyImage: TOLL_BROTHERS_LISTING_IMAGES[6],
    constructionProgress: 10,
    loanPreparedness: 40,
    milestones: [
      { label: 'Permitting & Site Prep', date: 'In Progress', current: true },
      { label: 'Foundation Poured', date: 'Est. Apr 01', pending: true },
      { label: 'Framing & Roofing', date: 'Est. May 15', pending: true },
      { label: 'Plumbing & Electrical', date: 'Est. Jul 10', pending: true },
    ],
    preparednessChecklist: [
      { task: 'Income Verification', status: 'Pending' },
      { task: 'Asset Verification', status: 'Pending' },
      { task: 'Credit Refresh', status: 'Pending' },
      { task: 'Homeowners Insurance', status: 'Not Started' },
      { task: 'Final Inspection', status: 'Pending' }
    ]
  },
  { 
    id: 8, 
    borrower: 'Gregory & Linda Foster', 
    lender: 'Toll Brothers Mortgage Company (Preferred)', 
    isPreferred: true,
    status: 'Foundation', 
    daysToClose: 155, 
    riskScore: 22,
    riskLevel: 'Low',
    los: 'Salesforce',
    sourceType: 'CRM',
    address: '11530 W Sterling Grove Blvd, Toll Brothers at Sterling Grove',
    city: 'Surprise',
    state: 'AZ',
    lat: 33.6292,
    lng: -112.3679,
    loanAmount: 712000,
    propertyValue: 890000,
    isHeloc: false,
    isNonQM: false,
    propertyImage: TOLL_BROTHERS_LISTING_IMAGES[7],
    constructionProgress: 15,
    loanPreparedness: 50,
    milestones: [
      { label: 'Permitting & Site Prep', date: 'Feb 15, 2026', completed: true },
      { label: 'Foundation Poured', date: 'In Progress', current: true },
      { label: 'Framing & Roofing', date: 'Est. Apr 20', pending: true },
      { label: 'Plumbing & Electrical', date: 'Est. Jun 15', pending: true },
    ],
    preparednessChecklist: [
      { task: 'Income Verification', status: 'Completed' },
      { task: 'Asset Verification', status: 'Pending' },
      { task: 'Credit Refresh', status: 'Pending' },
      { task: 'Homeowners Insurance', status: 'Not Started' },
      { task: 'Final Inspection', status: 'Pending' }
    ]
  },
];

// Generate 242 more realistic Toll Brothers listings across the USA
const generateMoreLoans = () => {
  const newLoans = [];
  const firstNames = [
    'Ava', 'Mia', 'Sophia', 'Isabella', 'Olivia', 'Amelia', 'Harper', 'Evelyn', 'Luna', 'Ella',
    'Noah', 'Liam', 'Elijah', 'James', 'Benjamin', 'Lucas', 'Henry', 'Alexander', 'Ethan', 'Daniel',
    'Charlotte', 'Grace', 'Chloe', 'Zoey', 'Nora', 'Aria', 'Layla', 'Hannah', 'Leah', 'Stella',
    'Mateo', 'Leo', 'Julian', 'Sebastian', 'Gabriel', 'Adrian', 'Isaac', 'Caleb', 'Owen', 'Jack',
  ];
  const lastNames = [
    'Chen', 'Rivera', 'Patel', 'Nguyen', 'Kim', 'Garcia', 'Martinez', 'Johnson', 'Williams', 'Brown',
    'Jones', 'Miller', 'Davis', 'Wilson', 'Anderson', 'Taylor', 'Thomas', 'Moore', 'Jackson', 'Martin',
    'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson',
    'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Flores', 'Green', 'Adams',
  ];

  const borrowerNameForId = (id: number) => {
    // Deterministic pseudo-random selection so names don't change between reloads.
    const a = 1664525;
    const c = 1013904223;
    let x = (id ^ 0x9e3779b9) >>> 0;
    x = (a * x + c) >>> 0;
    const first = firstNames[x % firstNames.length];
    x = (a * x + c) >>> 0;
    const last = lastNames[x % lastNames.length];
    return `${first} ${last}`;
  };

  const cities = [
    { city: 'Scottsdale', state: 'AZ', lat: 33.4942, lng: -111.9261 },
    { city: 'Irvine', state: 'CA', lat: 33.6846, lng: -117.8265 },
    { city: 'San Jose', state: 'CA', lat: 37.3382, lng: -121.8863 },
    { city: 'Denver', state: 'CO', lat: 39.7392, lng: -104.9903 },
    { city: 'Orlando', state: 'FL', lat: 28.5383, lng: -81.3792 },
    { city: 'Tampa', state: 'FL', lat: 27.9506, lng: -82.4572 },
    { city: 'Atlanta', state: 'GA', lat: 33.7490, lng: -84.3880 },
    { city: 'Boise', state: 'ID', lat: 43.6150, lng: -116.2023 },
    { city: 'Chicago', state: 'IL', lat: 41.8781, lng: -87.6298 },
    { city: 'Boston', state: 'MA', lat: 42.3601, lng: -71.0589 },
    { city: 'Bethesda', state: 'MD', lat: 38.9847, lng: -77.0947 },
    { city: 'Ann Arbor', state: 'MI', lat: 42.2808, lng: -83.7430 },
    { city: 'Charlotte', state: 'NC', lat: 35.2271, lng: -80.8431 },
    { city: 'Raleigh', state: 'NC', lat: 35.7796, lng: -78.6382 },
    { city: 'Princeton', state: 'NJ', lat: 40.3573, lng: -74.6672 },
    { city: 'Las Vegas', state: 'NV', lat: 36.1699, lng: -115.1398 },
    { city: 'New York', state: 'NY', lat: 40.7128, lng: -74.0060 },
    { city: 'Portland', state: 'OR', lat: 45.5152, lng: -122.6784 },
    { city: 'Philadelphia', state: 'PA', lat: 39.9526, lng: -75.1652 },
    { city: 'Charleston', state: 'SC', lat: 32.7765, lng: -79.9311 },
    { city: 'Nashville', state: 'TN', lat: 36.1627, lng: -86.7816 },
    { city: 'Austin', state: 'TX', lat: 30.2672, lng: -97.7431 },
    { city: 'Dallas', state: 'TX', lat: 32.7767, lng: -96.7970 },
    { city: 'Houston', state: 'TX', lat: 29.7604, lng: -95.3698 },
    { city: 'Salt Lake City', state: 'UT', lat: 40.7608, lng: -111.8910 },
    { city: 'Ashburn', state: 'VA', lat: 39.0438, lng: -77.4874 },
    { city: 'Seattle', state: 'WA', lat: 47.6062, lng: -122.3321 }
  ];

  const statuses = ['Permitting', 'Foundation', 'Framing', 'Drywall', 'Finishing'];
  const lenders = ['Toll Brothers Mortgage Company (Captive)', 'Toll Brothers Mortgage Company (Preferred)', 'Summit Mortgage', 'Pioneer Lending', 'Wells Fargo', 'Chase'];
  const images = TOLL_BROTHERS_LISTING_IMAGES;

  for (let i = 9; i <= 250; i++) {
    const loc = cities[Math.floor(Math.random() * cities.length)];
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    const lender = lenders[Math.floor(Math.random() * lenders.length)];
    const isPreferred = lender.includes('Toll Brothers');
    const loanAmt = Math.floor(Math.random() * 1500000) + 500000;
    
    // Add some random jitter to lat/lng so they aren't all exactly on the city center
    const latJitter = (Math.random() - 0.5) * 0.5;
    const lngJitter = (Math.random() - 0.5) * 0.5;

    newLoans.push({
      id: i,
      borrower: borrowerNameForId(i),
      lender: lender,
      isPreferred: isPreferred,
      status: status,
      daysToClose: Math.floor(Math.random() * 200) + 30,
      riskScore: Math.floor(Math.random() * 100),
      riskLevel: Math.random() > 0.8 ? 'High' : (Math.random() > 0.4 ? 'Medium' : 'Low'),
      los: 'ICE Encompass',
      erpSync: 'Hyphen BRIX',
      rateLock: { status: Math.random() > 0.5 ? 'Locked' : 'Floating', expires: '2026-08-15', type: 'Standard' },
      incentives: { type: 'Closing Credit', value: Math.floor(Math.random() * 20000) },
      sourceType: 'CRM',
      address: `${Math.floor(Math.random() * 9000) + 100} Main St, Toll Brothers at ${loc.city}`,
      city: loc.city,
      state: loc.state,
      lat: loc.lat + latJitter,
      lng: loc.lng + lngJitter,
      loanAmount: loanAmt,
      propertyValue: Math.floor(loanAmt * 1.2),
      isHeloc: false,
      propertyImage: images[Math.floor(Math.random() * images.length)],
      constructionProgress: Math.floor(Math.random() * 100),
      loanPreparedness: Math.floor(Math.random() * 100),
      milestones: [
        { label: 'Builder Contract Signed', date: 'Jan 10, 2026', completed: true },
        { label: 'Mortgage App Submitted', date: 'Jan 12, 2026', completed: true },
        { label: 'Foundation Poured', date: 'Feb 02, 2026', completed: true },
        { label: 'Framing & Roofing', date: 'In Progress', current: true },
        { label: 'Plumbing & Electrical', date: 'Est. Apr 10', pending: true },
      ],
      preparednessChecklist: [
        { task: 'Income Verification', status: 'Completed' },
        { task: 'Asset Verification', status: 'Completed' },
        { task: 'Credit Refresh', status: 'Pending' },
        { task: 'Homeowners Insurance', status: 'Not Started' },
        { task: 'Final Inspection', status: 'Pending' }
      ]
    });
  }
  return newLoans;
};

export const allLoans = [...loans, ...generateMoreLoans()];

export const contracts = [
  { id: 101, borrower: 'Sarah & Mark Jenkins', date: '2026-01-10', community: '100 West', status: 'Active', mortgageStatus: 'Applied (Preferred)' },
  { id: 102, borrower: 'David Miller', date: '2026-01-15', community: 'Sienna', status: 'Active', mortgageStatus: 'Applied (External)' },
  { id: 103, borrower: 'Elena Rodriguez', date: '2026-01-20', community: 'Bella Collina', status: 'Active', mortgageStatus: 'Applied (Preferred)' },
  { id: 104, borrower: 'The Henderson Family', date: '2025-11-25', community: 'Liseter', status: 'Active', mortgageStatus: 'Applied (Preferred)' },
  { id: 105, borrower: 'Robert Chen', date: '2026-01-25', community: 'Mesa Ridge', status: 'Active', mortgageStatus: 'Applied (External)' },
  { id: 106, borrower: 'Michael & Jane Smith', date: '2026-02-05', community: 'The Timbers', status: 'Active', mortgageStatus: 'Applied (Preferred)' },
  { id: 107, borrower: 'John Doe', date: '2026-03-01', community: '100 West', status: 'Active', mortgageStatus: 'Pending' },
  { id: 108, borrower: 'Jane Wilson', date: '2026-03-05', community: 'Sienna', status: 'Active', mortgageStatus: 'Pending' },
  { id: 109, borrower: 'Tom Brown', date: '2026-03-10', community: 'Bella Collina', status: 'Active', mortgageStatus: 'External' },
  { id: 110, borrower: 'Lucy Liu', date: '2026-03-12', community: 'Liseter', status: 'Active', mortgageStatus: 'Pending' },
];

export const leads = [
  { id: 501, name: 'Alice Green', source: 'Zillow', community: '100 West', status: 'Prospect' },
  { id: 502, name: 'Bob White', source: 'Builder Website', community: 'Sienna', status: 'Qualified' },
  { id: 503, name: 'Charlie Black', source: 'Walk-in', community: 'Bella Collina', status: 'Prospect' },
  { id: 504, name: 'Diana Prince', source: 'Referral', community: 'Liseter', status: 'Qualified' },
  { id: 505, name: 'Ethan Hunt', source: 'Zillow', community: 'Mesa Ridge', status: 'Prospect' },
];

export const expiringDocs = [
  { id: 1, loanId: 3, borrower: 'Elena Rodriguez', type: 'Rate Lock Agreement', expires: '2026-03-28', days: 9, status: 'critical' },
  { id: 2, loanId: 10, borrower: 'Sarah Connor', type: 'Income Verification', expires: '2026-03-30', days: 11, status: 'critical' },
  { id: 3, loanId: 9, borrower: 'Marcus Wright', type: 'Credit Report (120 Day)', expires: '2026-04-15', days: 27, status: 'warning' },
  { id: 4, loanId: 5, borrower: 'Robert Chen', type: 'Title Commitment', expires: '2026-04-20', days: 32, status: 'warning' },
  { id: 5, loanId: 2, borrower: 'David Miller', type: 'Insurance Binder', expires: '2026-05-05', days: 47, status: 'safe' },
];

export const riskFactors = [
  { 
    loanId: 3, 
    borrower: 'Elena Rodriguez', 
    score: 82, 
    level: 'High', 
    factors: [
      { category: 'Financials', impact: 'High', description: 'DTI elevated to 48% due to recent auto loan purchase.' },
      { category: 'Market', impact: 'Medium', description: 'Rate lock expiring in 9 days amid volatile rate environment.' },
      { category: 'Collateral', impact: 'High', description: 'LTV exceeds 90% based on preliminary appraisal.' }
    ]
  },
  { 
    loanId: 10, 
    borrower: 'Sarah Connor', 
    score: 95, 
    level: 'High', 
    factors: [
      { category: 'Household', impact: 'High', description: 'Reported change in household structure (pending divorce).' },
      { category: 'Assets', impact: 'Medium', description: 'Large unverified deposit requiring sourcing.' },
      { category: 'Qualification', impact: 'High', description: 'Single-income requalification required before closing.' }
    ]
  },
  { 
    loanId: 9, 
    borrower: 'Marcus Wright', 
    score: 68, 
    level: 'High', 
    factors: [
      { category: 'Employment', impact: 'High', description: 'Recent transition from W-2 to 1099 contractor status.' },
      { category: 'Reserves', impact: 'Medium', description: 'Post-closing reserves are below 3 months of PITI.' },
      { category: 'Credit', impact: 'Medium', description: 'Multiple recent credit inquiries in the last 30 days.' }
    ]
  },
];

export const respaApps = [
  {
    id: 'APP-2026-001',
    borrower: 'Sarah & Mark Jenkins',
    lender: 'Toll Brothers Mortgage Company (Preferred)',
    applicationDate: '2026-03-01',
    leStatus: 'Sent',
    leDate: '2026-03-03',
    cdStatus: 'Pending',
    cdDeadline: '2026-03-25',
    complianceScore: 98,
    status: 'On Track'
  },
  {
    id: 'APP-2026-002',
    borrower: 'David Miller',
    lender: 'Summit Mortgage',
    applicationDate: '2026-03-05',
    leStatus: 'Sent',
    leDate: '2026-03-07',
    cdStatus: 'Not Started',
    cdDeadline: '2026-04-02',
    complianceScore: 100,
    status: 'On Track'
  },
  {
    id: 'APP-2026-003',
    borrower: 'Elena Rodriguez',
    lender: 'Toll Brothers Mortgage Company (Preferred)',
    applicationDate: '2026-03-10',
    leStatus: 'Delayed',
    leDate: null,
    cdStatus: 'Not Started',
    cdDeadline: '2026-04-05',
    complianceScore: 65,
    status: 'At Risk'
  },
  {
    id: 'APP-2026-004',
    borrower: 'The Henderson Family',
    lender: 'Toll Brothers Mortgage Company (Preferred)',
    applicationDate: '2026-02-12',
    leStatus: 'Sent',
    leDate: '2026-02-14',
    cdStatus: 'Sent',
    cdDate: '2026-02-18',
    complianceScore: 95,
    status: 'Completed'
  }
];

/**
 * Integrations: Toll Brothers digital + mortgage partners, representative builder stack,
 * and Cohi DHR API (demo pattern—not a live vendor assertion for every row).
 */
export const integrations = [
  {
    id: 'toll-digital',
    name: 'Toll Brothers Web & App',
    type: 'Lead capture (digital)',
    status: 'Connected',
    logo: 'TB',
    description:
      'National website, community search, and mobile app drive first-touch buyer interest; Online Sales Consultants handle chat, text, and calls—typical top of funnel before a community visit.',
  },
  {
    id: 'toll-partner-api',
    name: 'Toll Brothers partner APIs',
    type: 'Builder / lender integrations',
    status: 'Connected',
    logo: 'TP',
    description:
      'Programmatic hooks for communities, inventory, and handoffs into mortgage workflows—paired with Cohi for capture and pipeline visibility.',
  },
  {
    id: 'dhr-api',
    name: 'DHR API',
    type: 'Cohi data hub / REST',
    status: 'Connected',
    logo: 'DH',
    description:
      'Structured REST API for agreements, capture status, loan milestones, and portfolio metrics—data warehouse, BI, and partner integrations.',
  },
  {
    id: 'encompass',
    name: 'ICE Encompass',
    type: 'LOS / Mortgage file',
    status: 'Connected',
    logo: 'IE',
    description:
      'Toll Brothers Mortgage publicly recruits Encompass developers—strong signal Encompass anchors loan origination, locks, disclosures, and loan-number data after the purchase agreement.',
  },
  {
    id: 'eci',
    name: 'ECI (MarkSystems family)',
    type: 'Builder sales / contracts (representative)',
    status: 'Connected',
    logo: 'EC',
    description:
      'Many production builders centralize options, lot status, and contract administration in ECI-class systems. Shown as industry-representative for where agreement fields often originate—confirm Toll’s production systems internally.',
  },
  {
    id: 'hyphen',
    name: 'Hyphen Solutions (BRIX)',
    type: 'Build platform / ERP sync',
    status: 'Connected',
    logo: 'HX',
    description:
      'Hyphen BRIX is a common integration layer between builder ERP and field/build data. Representative for construction milestone sync—not asserted as Toll’s exclusive platform.',
  },
  {
    id: 'buildpro',
    name: 'BuildPro',
    type: 'Construction scheduling',
    status: 'Connected',
    logo: 'BP',
    description:
      'Widely used scheduling and trade coordination in production homebuilding. Illustrative link from sold homes to construction execution.',
  },
  {
    id: 'loanlogics',
    name: 'LoanLogics (LoanHD)',
    type: 'QC / post-close audit',
    status: 'Connected',
    logo: 'LL',
    description:
      'Vendor case studies cite Toll Brothers Mortgage scaling QC with LoanLogics-style audit tooling—downstream of capture, not lead intake.',
  },
];
