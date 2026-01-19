// Comprehensive list of unique, diverse employee names
// Organized by tier to ensure no duplicates across sections

export const topTierNames = [
  'Marcus Wellington', 'Priya Patel', 'Derek Nakamura', 'Sophia Reyes', 'Brandon Mitchell',
  'Aisha Johnson', 'Tyler Okonkwo', 'Hannah Bergstrom', 'Rafael Santos', 'Megan O\'Brien',
  'Vincent Zhao', 'Courtney Williams', 'Jamal Thompson', 'Elena Kowalski', 'Christopher Huang',
  'Brianna Foster', 'Nathan Gupta', 'Jasmine Rivera', 'Ethan Christiansen', 'Olivia Yamamoto'
];

export const middleTierNames = [
  'Jordan Blackwell', 'Fatima Al-Hassan', 'Trevor Lindqvist', 'Carmen Delgado', 'Austin Porter',
  'Destiny Jackson', 'Blake Rasmussen', 'Yuki Tanaka', 'Cameron Fields', 'Aaliyah Brown',
  'Dylan Moreno', 'Samantha Nguyen', 'Connor O\'Sullivan', 'Gabriella Cruz', 'Ian Johansson',
  'Melanie Turner', 'Zachary Obi', 'Natasha Volkov', 'Joshua Hernandez', 'Taylor Kim',
  'Ricardo Fernandez', 'Brittany Walsh', 'Andre Williams', 'Michelle Sato', 'Gregory Paulsen',
  'Vanessa Romero', 'Keith Andersson', 'Jessica Chung', 'Dominic Rossi', 'Stephanie Okafor'
];

export const bottomTierNames = [
  'Kyle Morrison', 'Shaniqua Davis', 'Patrick O\'Malley', 'Rosa Gutierrez', 'Bradley Stone',
  'Tameka Robinson', 'Scott Nielsen', 'Lucia Mendoza', 'Drew Campbell', 'Keisha Harris',
  'Ryan Petersen', 'Diana Castellanos', 'Chad Larsen', 'Monique Baptiste', 'Seth Magnusson',
  'Alicia Vazquez', 'Derrick Hayes', 'Leila Amini', 'Troy Jensen', 'Candace Freeman',
  'Mitchell Burke', 'Jasmin Ortega', 'Corey Sullivan', 'Tiffany Washington', 'Wesley Olsen',
  'Renee Dominguez', 'Brett Hoffman', 'Latoya Carter', 'Gavin Murray', 'Simone Beaumont',
  'Rodney Fischer', 'Denise Ramos', 'Craig Lindberg', 'Veronica Silva', 'Spencer Collins',
  'Monica Espinoza', 'Terrence Boyd', 'Heather Jacobsen', 'Reginald Watts', 'Crystal Duarte'
];

// Branch managers - unique names
export const branchManagerNames = [
  'Margaret Chen-Williams', 'Douglas Petrov', 'Lakshmi Krishnamurthy', 'Harold Stephenson',
  'Beatrice Okonkwo-Smith'
];

// Operations team - unique names for ReportModal
export const operationsTeamNames = [
  'Valentina Rossi', 'Benjamin Kowalczyk', 'Naomi Takahashi', 'Lawrence Fitzgerald',
  'Ingrid Johansson', 'Marcus Oyelaran'
];

// LO Performance Report names
export const topPerformerNames = [
  'Sarah Martinez-Ruiz', 'Michael Chen-Wong', 'Emily Rodriguez-Garcia', 'James Wilson III',
  'Lisa Anderson-Taylor'
];

export const coachingNeededNames = [
  'Jonathan Murphy', 'Mary Ellen Johnson', 'David Wei Lee'
];

// Fallout case names - unique borrower names
export const borrowerNames = [
  'Theodore Reynolds', 'Marguerite St. Claire', 'Benjamin Nakagawa', 'Priscilla Worthington',
  'Eduardo Villareal', 'Catherine O\'Donnell', 'Rashid Al-Mansour', 'Lorraine Dubois',
  'Nathaniel Pemberton', 'Esperanza Vega-Lopez', 'Franklin Whitmore', 'Genevieve Bellamy',
  'Omar Benyamin', 'Constance Harrington', 'Reginald Thornton'
];

// Function to get a random name from a list (for dynamic use)
export const getRandomName = (excludeList: string[] = []): string => {
  const allNames = [...topTierNames, ...middleTierNames, ...bottomTierNames];
  const availableNames = allNames.filter(name => !excludeList.includes(name));
  return availableNames[Math.floor(Math.random() * availableNames.length)] || 'Unknown Employee';
};

