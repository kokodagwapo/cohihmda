/**
 * LOS Field Library - Backend Version
 * Comprehensive library of all possible loan origination system fields
 * Used for automatic CSV column identification and mapping
 * This matches the frontend library for consistent field mapping
 */

export interface LOSField {
  sourceKey: string;
  displayName: string;
  category: 'basic' | 'borrower' | 'property' | 'financial' | 'underwriting' | 'closing' | 'servicing' | 'metadata';
  dataType: 'string' | 'number' | 'date' | 'boolean' | 'currency' | 'percentage';
  required: boolean;
  description?: string;
  aliases?: string[];
  encompassFieldId?: string;
}

/**
 * Comprehensive LOS Field Library
 * This matches the frontend library exactly for consistent field mapping
 */
export const LOS_FIELD_LIBRARY: LOSField[] = [
  // Basic Loan Information
  {
    sourceKey: 'loan_id',
    displayName: 'Loan ID',
    category: 'basic',
    dataType: 'string',
    required: true,
    description: 'Unique identifier for the loan',
    aliases: ['loan_number', 'loanNumber', 'application_id', 'applicationId', 'loanId', 'id'],
  },
  {
    sourceKey: 'loan_amount',
    displayName: 'Loan Amount',
    category: 'basic',
    dataType: 'currency',
    required: true,
    description: 'Total loan amount',
    aliases: ['amount', 'loanAmount', 'principal_amount', 'principalAmount', 'requested_amount', 'requestedAmount'],
  },
  {
    sourceKey: 'loan_type',
    displayName: 'Loan Type',
    category: 'basic',
    dataType: 'string',
    required: false,
    description: 'Type of loan (Conventional, FHA, VA, USDA, etc.)',
    aliases: ['product_type', 'productType', 'loan_product', 'loanProduct', 'product', 'loanPurpose'],
  },
  {
    sourceKey: 'status',
    displayName: 'Status',
    category: 'basic',
    dataType: 'string',
    required: false,
    description: 'Current loan status',
    aliases: ['loan_status', 'loanStatus', 'application_status', 'applicationStatus', 'state', 'stage'],
  },
  {
    sourceKey: 'application_date',
    displayName: 'Application Date',
    category: 'basic',
    dataType: 'date',
    required: false,
    description: 'Date loan application was submitted',
    aliases: ['app_date', 'appDate', 'applicationDate', 'submitted_date', 'submittedDate', 'created_date', 'createdDate'],
  },
  {
    sourceKey: 'closing_date',
    displayName: 'Closing Date',
    category: 'basic',
    dataType: 'date',
    required: false,
    description: 'Date loan was closed/funded',
    aliases: ['close_date', 'closeDate', 'closingDate', 'fund_date', 'fundDate', 'funded_date', 'fundedDate'],
  },
  {
    sourceKey: 'interest_rate',
    displayName: 'Interest Rate',
    category: 'basic',
    dataType: 'percentage',
    required: false,
    description: 'Loan interest rate',
    aliases: ['rate', 'interestRate', 'apr', 'APR', 'note_rate', 'noteRate'],
  },

  // Borrower Information
  {
    sourceKey: 'borrower_name',
    displayName: 'Borrower Name',
    category: 'borrower',
    dataType: 'string',
    required: false,
    description: 'Primary borrower full name',
    aliases: ['applicant_name', 'applicantName', 'name', 'borrowerName', 'customer_name', 'customerName'],
  },
  {
    sourceKey: 'borrower_first_name',
    displayName: 'Borrower First Name',
    category: 'borrower',
    dataType: 'string',
    required: false,
    description: 'Primary borrower first name',
    aliases: ['first_name', 'firstName', 'borrowerFirstName', 'applicant_first_name', 'applicantFirstName'],
  },
  {
    sourceKey: 'borrower_last_name',
    displayName: 'Borrower Last Name',
    category: 'borrower',
    dataType: 'string',
    required: false,
    description: 'Primary borrower last name',
    aliases: ['last_name', 'lastName', 'borrowerLastName', 'applicant_last_name', 'applicantLastName'],
  },
  {
    sourceKey: 'borrower_email',
    displayName: 'Borrower Email',
    category: 'borrower',
    dataType: 'string',
    required: false,
    description: 'Primary borrower email address',
    aliases: ['email', 'borrowerEmail', 'applicant_email', 'applicantEmail', 'customer_email', 'customerEmail'],
  },
  {
    sourceKey: 'borrower_phone',
    displayName: 'Borrower Phone',
    category: 'borrower',
    dataType: 'string',
    required: false,
    description: 'Primary borrower phone number',
    aliases: ['phone', 'borrowerPhone', 'applicant_phone', 'applicantPhone', 'customer_phone', 'customerPhone'],
  },
  {
    sourceKey: 'borrower_ssn',
    displayName: 'Borrower SSN',
    category: 'borrower',
    dataType: 'string',
    required: false,
    description: 'Primary borrower Social Security Number (anonymized in demo)',
    aliases: ['ssn', 'borrowerSSN', 'social_security_number', 'socialSecurityNumber'],
  },
  {
    sourceKey: 'borrower_dob',
    displayName: 'Borrower Date of Birth',
    category: 'borrower',
    dataType: 'date',
    required: false,
    description: 'Primary borrower date of birth',
    aliases: ['dob', 'borrowerDOB', 'date_of_birth', 'dateOfBirth', 'birth_date', 'birthDate'],
  },
  {
    sourceKey: 'co_borrower_name',
    displayName: 'Co-Borrower Name',
    category: 'borrower',
    dataType: 'string',
    required: false,
    description: 'Co-borrower full name',
    aliases: ['coborrower_name', 'coborrowerName', 'co_borrowerName', 'coBorrowerName'],
  },

  // Property Information
  {
    sourceKey: 'property_address',
    displayName: 'Property Address',
    category: 'property',
    dataType: 'string',
    required: false,
    description: 'Property street address',
    aliases: ['address', 'propertyAddress', 'subject_property_address', 'subjectPropertyAddress'],
  },
  {
    sourceKey: 'property_city',
    displayName: 'Property City',
    category: 'property',
    dataType: 'string',
    required: false,
    description: 'Property city',
    aliases: ['city', 'propertyCity', 'subject_property_city', 'subjectPropertyCity'],
  },
  {
    sourceKey: 'property_state',
    displayName: 'Property State',
    category: 'property',
    dataType: 'string',
    required: false,
    description: 'Property state',
    aliases: ['state', 'propertyState', 'subject_property_state', 'subjectPropertyState'],
  },
  {
    sourceKey: 'property_zip',
    displayName: 'Property ZIP',
    category: 'property',
    dataType: 'string',
    required: false,
    description: 'Property ZIP code',
    aliases: ['zip', 'zip_code', 'zipCode', 'propertyZip', 'subject_property_zip', 'subjectPropertyZip'],
    encompassFieldId: 'Fields.15',
  },
  {
    sourceKey: 'property_value',
    displayName: 'Property Value',
    category: 'property',
    dataType: 'currency',
    required: false,
    description: 'Appraised or estimated property value',
    aliases: ['propertyValue', 'appraised_value', 'appraisedValue', 'estimated_value', 'estimatedValue'],
  },
  {
    sourceKey: 'property_type',
    displayName: 'Property Type',
    category: 'property',
    dataType: 'string',
    required: false,
    description: 'Type of property (Single Family, Condo, etc.)',
    aliases: ['propertyType', 'subject_property_type', 'subjectPropertyType'],
  },

  // Financial Information
  {
    sourceKey: 'loan_purpose',
    displayName: 'Loan Purpose',
    category: 'financial',
    dataType: 'string',
    required: false,
    description: 'Purpose of loan (Purchase, Refinance, Cash-Out, etc.)',
    aliases: ['purpose', 'loanPurpose', 'transaction_type', 'transactionType'],
  },
  {
    sourceKey: 'ltv',
    displayName: 'Loan-to-Value (LTV)',
    category: 'financial',
    dataType: 'percentage',
    required: false,
    description: 'Loan-to-value ratio',
    aliases: ['loan_to_value', 'loanToValue', 'ltv_ratio', 'ltvRatio'],
  },
  {
    sourceKey: 'cltv',
    displayName: 'Combined LTV (CLTV)',
    category: 'financial',
    dataType: 'percentage',
    required: false,
    description: 'Combined loan-to-value ratio',
    aliases: ['combined_ltv', 'combinedLTV', 'cltv_ratio', 'cltvRatio'],
  },
  {
    sourceKey: 'fico_score',
    displayName: 'FICO Score',
    category: 'financial',
    dataType: 'number',
    required: false,
    description: 'Borrower FICO credit score',
    aliases: ['fico', 'credit_score', 'creditScore', 'ficoScore', 'middle_fico', 'middleFICO'],
  },
  {
    sourceKey: 'debt_to_income',
    displayName: 'Debt-to-Income (DTI)',
    category: 'financial',
    dataType: 'percentage',
    required: false,
    description: 'Debt-to-income ratio',
    aliases: ['dti', 'debt_to_income_ratio', 'debtToIncomeRatio', 'dti_ratio', 'dtiRatio'],
  },
  {
    sourceKey: 'monthly_income',
    displayName: 'Monthly Income',
    category: 'financial',
    dataType: 'currency',
    required: false,
    description: 'Borrower monthly income',
    aliases: ['income', 'monthlyIncome', 'borrower_income', 'borrowerIncome'],
  },
  {
    sourceKey: 'down_payment',
    displayName: 'Down Payment',
    category: 'financial',
    dataType: 'currency',
    required: false,
    description: 'Down payment amount',
    aliases: ['downPayment', 'down_payment_amount', 'downPaymentAmount'],
  },
  {
    sourceKey: 'down_payment_percent',
    displayName: 'Down Payment %',
    category: 'financial',
    dataType: 'percentage',
    required: false,
    description: 'Down payment percentage',
    aliases: ['down_payment_pct', 'downPaymentPct', 'down_payment_percentage', 'downPaymentPercentage'],
  },

  // Underwriting Information
  {
    sourceKey: 'lock_date',
    displayName: 'Lock Date',
    category: 'underwriting',
    dataType: 'date',
    required: false,
    description: 'Date interest rate was locked',
    aliases: ['lockDate', 'rate_lock_date', 'rateLockDate', 'locked_date', 'lockedDate'],
  },
  {
    sourceKey: 'lock_expiration_date',
    displayName: 'Lock Expiration Date',
    category: 'underwriting',
    dataType: 'date',
    required: false,
    description: 'Date interest rate lock expires',
    aliases: ['lockExpirationDate', 'rate_lock_expiration', 'rateLockExpiration', 'lock_expires', 'lockExpires'],
  },
  {
    sourceKey: 'submitted_to_uw_date',
    displayName: 'Submitted to UW Date',
    category: 'underwriting',
    dataType: 'date',
    required: false,
    description: 'Date submitted to underwriting',
    aliases: ['submittedDate', 'submitted_to_underwriting', 'submittedToUnderwriting', 'uw_submission_date', 'uwSubmissionDate'],
  },
  {
    sourceKey: 'approved_date',
    displayName: 'Approved Date',
    category: 'underwriting',
    dataType: 'date',
    required: false,
    description: 'Date loan was approved',
    aliases: ['approvalDate', 'approvedDate', 'approval_date', 'underwriting_approval_date', 'underwritingApprovalDate'],
  },
  {
    sourceKey: 'ctc_date',
    displayName: 'Clear to Close Date',
    category: 'underwriting',
    dataType: 'date',
    required: false,
    description: 'Date loan was cleared to close',
    aliases: ['ctcDate', 'clear_to_close_date', 'clearToCloseDate', 'ctc', 'cleared_to_close', 'clearedToClose'],
  },
  {
    sourceKey: 'credit_pull_date',
    displayName: 'Credit Pull Date',
    category: 'underwriting',
    dataType: 'date',
    required: false,
    description: 'Date credit was pulled',
    aliases: ['creditPullDate', 'credit_pull', 'creditPull', 'credit_report_date', 'creditReportDate'],
  },
  {
    sourceKey: 'underwriter_name',
    displayName: 'Underwriter Name',
    category: 'underwriting',
    dataType: 'string',
    required: false,
    description: 'Assigned underwriter name',
    aliases: ['underwriter', 'underwriterName', 'uw_name', 'uwName', 'assigned_underwriter', 'assignedUnderwriter'],
  },

  // Closing Information
  {
    sourceKey: 'closing_agent',
    displayName: 'Closing Agent',
    category: 'closing',
    dataType: 'string',
    required: false,
    description: 'Closing agent or title company',
    aliases: ['closingAgent', 'title_company', 'titleCompany', 'settlement_agent', 'settlementAgent'],
  },
  {
    sourceKey: 'closing_location',
    displayName: 'Closing Location',
    category: 'closing',
    dataType: 'string',
    required: false,
    description: 'Location where closing occurred',
    aliases: ['closingLocation', 'settlement_location', 'settlementLocation'],
  },
  {
    sourceKey: 'funding_date',
    displayName: 'Funding Date',
    category: 'closing',
    dataType: 'date',
    required: false,
    description: 'Date loan was funded',
    aliases: ['fundDate', 'funded_date', 'fundedDate', 'disbursement_date', 'disbursementDate'],
  },
  {
    sourceKey: 'recording_date',
    displayName: 'Recording Date',
    category: 'closing',
    dataType: 'date',
    required: false,
    description: 'Date documents were recorded',
    aliases: ['recordingDate', 'recorded_date', 'recordedDate'],
  },

  // Servicing Information
  {
    sourceKey: 'servicing_released',
    displayName: 'Servicing Released',
    category: 'servicing',
    dataType: 'boolean',
    required: false,
    description: 'Whether servicing has been released',
    aliases: ['servicingReleased', 'service_released', 'serviceReleased'],
  },
  {
    sourceKey: 'servicing_transfer_date',
    displayName: 'Servicing Transfer Date',
    category: 'servicing',
    dataType: 'date',
    required: false,
    description: 'Date servicing was transferred',
    aliases: ['servicingTransferDate', 'service_transfer_date', 'serviceTransferDate'],
  },
  {
    sourceKey: 'current_servicer',
    displayName: 'Current Servicer',
    category: 'servicing',
    dataType: 'string',
    required: false,
    description: 'Current loan servicer',
    aliases: ['servicer', 'currentServicer', 'servicing_company', 'servicingCompany'],
  },

  // Metadata
  {
    sourceKey: 'loan_officer_id',
    displayName: 'Loan Officer ID',
    category: 'metadata',
    dataType: 'string',
    required: false,
    description: 'ID of assigned loan officer',
    aliases: ['lo_id', 'loId', 'loanOfficerId', 'originator_id', 'originatorId'],
  },
  {
    sourceKey: 'loan_officer_name',
    displayName: 'Loan Officer Name',
    category: 'metadata',
    dataType: 'string',
    required: false,
    description: 'Name of assigned loan officer',
    aliases: ['lo_name', 'loName', 'loanOfficerName', 'originator_name', 'originatorName'],
  },
  {
    sourceKey: 'branch',
    displayName: 'Branch',
    category: 'metadata',
    dataType: 'string',
    required: false,
    description: 'Branch or office location',
    aliases: ['branch_name', 'branchName', 'office', 'office_name', 'officeName'],
  },
  {
    sourceKey: 'channel',
    displayName: 'Channel',
    category: 'metadata',
    dataType: 'string',
    required: false,
    description: 'Origination channel (Retail, Wholesale, etc.)',
    aliases: ['origination_channel', 'originationChannel', 'channel_type', 'channelType'],
  },
  {
    sourceKey: 'cycle_time_days',
    displayName: 'Cycle Time (Days)',
    category: 'metadata',
    dataType: 'number',
    required: false,
    description: 'Total days from application to funding',
    aliases: ['cycleTime', 'cycle_time', 'days_to_fund', 'daysToFund', 'processing_days', 'processingDays'],
  },
  
  // Additional Encompass ICE Fields - Comprehensive lending field library
  // Property & Address Fields
  {
    sourceKey: 'property_street_address',
    displayName: 'Property Street Address',
    category: 'property',
    dataType: 'string',
    required: false,
    description: 'Property street address',
    aliases: ['street_address', 'streetAddress', 'subject_property_street'],
    encompassFieldId: 'Fields.14',
  },
  {
    sourceKey: 'property_unit_number',
    displayName: 'Property Unit Number',
    category: 'property',
    dataType: 'string',
    required: false,
    description: 'Property unit or apartment number',
    aliases: ['unit_number', 'unitNumber', 'apartment_number'],
    encompassFieldId: 'Fields.16',
  },
  {
    sourceKey: 'property_county',
    displayName: 'Property County',
    category: 'property',
    dataType: 'string',
    required: false,
    description: 'Property county',
    aliases: ['county', 'propertyCounty'],
    encompassFieldId: 'Fields.17',
  },
  
  // Borrower Employment Fields
  {
    sourceKey: 'borrower_employer',
    displayName: 'Borrower Employer',
    category: 'borrower',
    dataType: 'string',
    required: false,
    description: 'Primary borrower employer name',
    aliases: ['employer', 'borrowerEmployer', 'employer_name', 'employerName'],
    encompassFieldId: 'Fields.FE0102',
  },
  {
    sourceKey: 'borrower_position',
    displayName: 'Borrower Position',
    category: 'borrower',
    dataType: 'string',
    required: false,
    description: 'Primary borrower job position/title',
    aliases: ['position', 'borrowerPosition', 'job_title', 'jobTitle'],
    encompassFieldId: 'Fields.FE0110',
  },
  {
    sourceKey: 'borrower_years_on_job',
    displayName: 'Borrower Years on Job',
    category: 'borrower',
    dataType: 'number',
    required: false,
    description: 'Years at current employment',
    aliases: ['years_on_job', 'yearsOnJob', 'employment_years', 'employmentYears'],
    encompassFieldId: 'Fields.FE0113',
  },
  {
    sourceKey: 'borrower_years_on_job_2nd',
    displayName: 'Borrower Years on Job - 2nd',
    category: 'borrower',
    dataType: 'number',
    required: false,
    description: 'Years at second employment',
    aliases: ['years_on_job_2nd', 'yearsOnJob2nd'],
    encompassFieldId: 'Fields.FE0113#2',
  },
  
  // Financial & Underwriting Fields
  {
    sourceKey: 'msr_value',
    displayName: 'MSR Value',
    category: 'financial',
    dataType: 'currency',
    required: false,
    description: 'Mortgage Servicing Rights value',
    aliases: ['msrValue', 'mortgage_servicing_rights', 'mortgageServicingRights'],
    encompassFieldId: 'Fields.4118',
  },
  {
    sourceKey: 'cd_applied_cure',
    displayName: 'CD Applied Cure',
    category: 'closing',
    dataType: 'currency',
    required: false,
    description: 'Closing Disclosure applied cure amount',
    aliases: ['cdAppliedCure', 'cd_cure', 'cdCure'],
    encompassFieldId: 'Fields.CD2.X2',
  },
  {
    sourceKey: 'cd_lender_credits',
    displayName: 'CD Lender Credits',
    category: 'closing',
    dataType: 'currency',
    required: false,
    description: 'Closing Disclosure lender credits',
    aliases: ['cdLenderCredits', 'lender_credits', 'lenderCredits'],
    encompassFieldId: 'Fields.CD2.XSTLC',
  },
  {
    sourceKey: 'appraisal_received_date',
    displayName: 'Appraisal Received Date',
    category: 'underwriting',
    dataType: 'date',
    required: false,
    description: 'Date appraisal was received',
    aliases: ['appraisalReceivedDate', 'appraisal_date', 'appraisalDate'],
    encompassFieldId: 'Fields.Document.DateReceived.Appraisal',
  },
  {
    sourceKey: 'du_lp_case_id',
    displayName: 'DU/LP Case ID',
    category: 'underwriting',
    dataType: 'string',
    required: false,
    description: 'Desktop Underwriter/Loan Prospector case ID',
    aliases: ['duLpCaseId', 'du_case_id', 'duCaseId', 'lp_case_id', 'lpCaseId'],
    encompassFieldId: 'Fields.DU.LP.ID',
  },
  
  // Additional common Encompass fields
  {
    sourceKey: 'loan_number',
    displayName: 'Loan Number',
    category: 'basic',
    dataType: 'string',
    required: false,
    description: 'Encompass loan number',
    aliases: ['encompass_loan_number', 'encompassLoanNumber'],
    encompassFieldId: 'Fields.1',
  },
  {
    sourceKey: 'borrower_middle_name',
    displayName: 'Borrower Middle Name',
    category: 'borrower',
    dataType: 'string',
    required: false,
    description: 'Primary borrower middle name',
    aliases: ['middle_name', 'middleName', 'borrowerMiddleName'],
    encompassFieldId: 'Fields.400',
  },
  {
    sourceKey: 'co_borrower_first_name',
    displayName: 'Co-Borrower First Name',
    category: 'borrower',
    dataType: 'string',
    required: false,
    description: 'Co-borrower first name',
    aliases: ['coBorrowerFirstName', 'coborrower_first_name'],
    encompassFieldId: 'Fields.1100',
  },
  {
    sourceKey: 'co_borrower_last_name',
    displayName: 'Co-Borrower Last Name',
    category: 'borrower',
    dataType: 'string',
    required: false,
    description: 'Co-borrower last name',
    aliases: ['coBorrowerLastName', 'coborrower_last_name'],
    encompassFieldId: 'Fields.1101',
  },
  {
    sourceKey: 'property_sales_price',
    displayName: 'Property Sales Price',
    category: 'property',
    dataType: 'currency',
    required: false,
    description: 'Property sales price',
    aliases: ['sales_price', 'salesPrice', 'purchase_price', 'purchasePrice'],
    encompassFieldId: 'Fields.2',
  },
  {
    sourceKey: 'property_appraised_value',
    displayName: 'Property Appraised Value',
    category: 'property',
    dataType: 'currency',
    required: false,
    description: 'Appraised property value',
    aliases: ['appraised_value', 'appraisedValue', 'appraisal_value', 'appraisalValue'],
    encompassFieldId: 'Fields.3',
  },
  {
    sourceKey: 'loan_term_months',
    displayName: 'Loan Term (Months)',
    category: 'basic',
    dataType: 'number',
    required: false,
    description: 'Loan term in months',
    aliases: ['loan_term', 'loanTerm', 'term', 'term_months', 'termMonths'],
    encompassFieldId: 'Fields.4',
  },
  {
    sourceKey: 'amortization_type',
    displayName: 'Amortization Type',
    category: 'basic',
    dataType: 'string',
    required: false,
    description: 'Loan amortization type',
    aliases: ['amortizationType', 'amort_type', 'amortType'],
    encompassFieldId: 'Fields.5',
  },
  {
    sourceKey: 'occupancy_type',
    displayName: 'Occupancy Type',
    category: 'property',
    dataType: 'string',
    required: false,
    description: 'Property occupancy type (Primary, Secondary, Investment)',
    aliases: ['occupancyType', 'occupancy', 'occupancy_status', 'occupancyStatus'],
    encompassFieldId: 'Fields.19',
  },
  {
    sourceKey: 'property_usage_type',
    displayName: 'Property Usage Type',
    category: 'property',
    dataType: 'string',
    required: false,
    description: 'Property usage type',
    aliases: ['propertyUsageType', 'usage_type', 'usageType'],
    encompassFieldId: 'Fields.20',
  },
  {
    sourceKey: 'lock_period_days',
    displayName: 'Lock Period (Days)',
    category: 'underwriting',
    dataType: 'number',
    required: false,
    description: 'Interest rate lock period in days',
    aliases: ['lockPeriod', 'lock_period', 'rate_lock_period', 'rateLockPeriod'],
    encompassFieldId: 'Fields.334',
  },
  {
    sourceKey: 'lock_type',
    displayName: 'Lock Type',
    category: 'underwriting',
    dataType: 'string',
    required: false,
    description: 'Rate lock type (Float, Locked, etc.)',
    aliases: ['lockType', 'rate_lock_type', 'rateLockType'],
    encompassFieldId: 'Fields.335',
  },
  {
    sourceKey: 'total_assets',
    displayName: 'Total Assets',
    category: 'financial',
    dataType: 'currency',
    required: false,
    description: 'Borrower total assets',
    aliases: ['totalAssets', 'assets', 'total_asset_value', 'totalAssetValue'],
    encompassFieldId: 'Fields.1000',
  },
  {
    sourceKey: 'total_liabilities',
    displayName: 'Total Liabilities',
    category: 'financial',
    dataType: 'currency',
    required: false,
    description: 'Borrower total liabilities',
    aliases: ['totalLiabilities', 'liabilities', 'total_liability_value', 'totalLiabilityValue'],
    encompassFieldId: 'Fields.1001',
  },
  {
    sourceKey: 'reserves',
    displayName: 'Reserves',
    category: 'financial',
    dataType: 'currency',
    required: false,
    description: 'Borrower reserves',
    aliases: ['reserve_amount', 'reserveAmount', 'cash_reserves', 'cashReserves'],
    encompassFieldId: 'Fields.1002',
  },
  {
    sourceKey: 'gift_funds',
    displayName: 'Gift Funds',
    category: 'financial',
    dataType: 'currency',
    required: false,
    description: 'Gift funds amount',
    aliases: ['giftFunds', 'gift_fund_amount', 'giftFundAmount'],
    encompassFieldId: 'Fields.1003',
  },
  {
    sourceKey: 'seller_credits',
    displayName: 'Seller Credits',
    category: 'financial',
    dataType: 'currency',
    required: false,
    description: 'Seller credit amount',
    aliases: ['sellerCredits', 'seller_credit', 'sellerCredit'],
    encompassFieldId: 'Fields.1004',
  },
  {
    sourceKey: 'loan_to_cost',
    displayName: 'Loan to Cost (LTC)',
    category: 'financial',
    dataType: 'percentage',
    required: false,
    description: 'Loan-to-cost ratio',
    aliases: ['ltc', 'loan_to_cost_ratio', 'loanToCostRatio'],
    encompassFieldId: 'Fields.1005',
  },
  {
    sourceKey: 'combined_ltv_cltv',
    displayName: 'Combined LTV (CLTV)',
    category: 'financial',
    dataType: 'percentage',
    required: false,
    description: 'Combined loan-to-value including second liens',
    aliases: ['cltv', 'combined_ltv', 'combinedLTV'],
    encompassFieldId: 'Fields.1006',
  },
  {
    sourceKey: 'housing_ratio',
    displayName: 'Housing Ratio',
    category: 'financial',
    dataType: 'percentage',
    required: false,
    description: 'Front-end debt-to-income ratio (housing payment to income)',
    aliases: ['housingRatio', 'front_end_dti', 'frontEndDti', 'housing_dti', 'housingDti'],
    encompassFieldId: 'Fields.1007',
  },
  {
    sourceKey: 'total_debt_ratio',
    displayName: 'Total Debt Ratio',
    category: 'financial',
    dataType: 'percentage',
    required: false,
    description: 'Back-end debt-to-income ratio (total debt to income)',
    aliases: ['totalDebtRatio', 'back_end_dti', 'backEndDti', 'total_dti', 'totalDti'],
    encompassFieldId: 'Fields.1008',
  },
  {
    sourceKey: 'credit_score_equifax',
    displayName: 'Equifax Credit Score',
    category: 'financial',
    dataType: 'number',
    required: false,
    description: 'Equifax credit score',
    aliases: ['equifax_score', 'equifaxScore', 'eq_score', 'eqScore'],
    encompassFieldId: 'Fields.1009',
  },
  {
    sourceKey: 'credit_score_experian',
    displayName: 'Experian Credit Score',
    category: 'financial',
    dataType: 'number',
    required: false,
    description: 'Experian credit score',
    aliases: ['experian_score', 'experianScore', 'exp_score', 'expScore'],
    encompassFieldId: 'Fields.1010',
  },
  {
    sourceKey: 'credit_score_transunion',
    displayName: 'TransUnion Credit Score',
    category: 'financial',
    dataType: 'number',
    required: false,
    description: 'TransUnion credit score',
    aliases: ['transunion_score', 'transunionScore', 'tu_score', 'tuScore'],
    encompassFieldId: 'Fields.1011',
  },
  {
    sourceKey: 'middle_fico_score',
    displayName: 'Middle FICO Score',
    category: 'financial',
    dataType: 'number',
    required: false,
    description: 'Middle of three credit scores',
    aliases: ['middleFico', 'middle_fico', 'mid_fico', 'midFico'],
    encompassFieldId: 'Fields.1012',
  },
  {
    sourceKey: 'loan_program',
    displayName: 'Loan Program',
    category: 'basic',
    dataType: 'string',
    required: false,
    description: 'Loan program name',
    aliases: ['program', 'loanProgram', 'product_name', 'productName'],
    encompassFieldId: 'Fields.1013',
  },
  {
    sourceKey: 'loan_purpose_detail',
    displayName: 'Loan Purpose Detail',
    category: 'financial',
    dataType: 'string',
    required: false,
    description: 'Detailed loan purpose',
    aliases: ['loanPurposeDetail', 'purpose_detail', 'purposeDetail'],
    encompassFieldId: 'Fields.1014',
  },
  {
    sourceKey: 'refinance_cash_out_amount',
    displayName: 'Refinance Cash Out Amount',
    category: 'financial',
    dataType: 'currency',
    required: false,
    description: 'Cash-out refinance amount',
    aliases: ['cashOutAmount', 'cash_out', 'cashOut', 'refi_cash_out', 'refiCashOut'],
    encompassFieldId: 'Fields.1015',
  },
  {
    sourceKey: 'mi_required',
    displayName: 'MI Required',
    category: 'financial',
    dataType: 'boolean',
    required: false,
    description: 'Whether mortgage insurance is required',
    aliases: ['miRequired', 'mortgage_insurance_required', 'mortgageInsuranceRequired', 'pmi_required', 'pmiRequired'],
    encompassFieldId: 'Fields.1016',
  },
  {
    sourceKey: 'mi_rate',
    displayName: 'MI Rate',
    category: 'financial',
    dataType: 'percentage',
    required: false,
    description: 'Mortgage insurance rate',
    aliases: ['miRate', 'mortgage_insurance_rate', 'mortgageInsuranceRate', 'pmi_rate', 'pmiRate'],
    encompassFieldId: 'Fields.1017',
  },
  {
    sourceKey: 'mi_company',
    displayName: 'MI Company',
    category: 'financial',
    dataType: 'string',
    required: false,
    description: 'Mortgage insurance company',
    aliases: ['miCompany', 'mortgage_insurance_company', 'mortgageInsuranceCompany', 'pmi_company', 'pmiCompany'],
    encompassFieldId: 'Fields.1018',
  },
  {
    sourceKey: 'title_company',
    displayName: 'Title Company',
    category: 'closing',
    dataType: 'string',
    required: false,
    description: 'Title company name',
    aliases: ['titleCompany', 'title_insurance_company', 'titleInsuranceCompany'],
    encompassFieldId: 'Fields.1019',
  },
  {
    sourceKey: 'escrow_company',
    displayName: 'Escrow Company',
    category: 'closing',
    dataType: 'string',
    required: false,
    description: 'Escrow company name',
    aliases: ['escrowCompany', 'settlement_company', 'settlementCompany'],
    encompassFieldId: 'Fields.1020',
  },
  {
    sourceKey: 'appraisal_company',
    displayName: 'Appraisal Company',
    category: 'underwriting',
    dataType: 'string',
    required: false,
    description: 'Appraisal company name',
    aliases: ['appraisalCompany', 'appraiser_company', 'appraiserCompany'],
    encompassFieldId: 'Fields.1021',
  },
  {
    sourceKey: 'appraisal_value',
    displayName: 'Appraisal Value',
    category: 'property',
    dataType: 'currency',
    required: false,
    description: 'Appraised property value',
    aliases: ['appraisalValue', 'appraised_value', 'appraisedValue'],
    encompassFieldId: 'Fields.1022',
  },
  {
    sourceKey: 'appraisal_ordered_date',
    displayName: 'Appraisal Ordered Date',
    category: 'underwriting',
    dataType: 'date',
    required: false,
    description: 'Date appraisal was ordered',
    aliases: ['appraisalOrderedDate', 'appraisal_order_date', 'appraisalOrderDate'],
    encompassFieldId: 'Fields.1023',
  },
  {
    sourceKey: 'flood_zone',
    displayName: 'Flood Zone',
    category: 'property',
    dataType: 'string',
    required: false,
    description: 'FEMA flood zone designation',
    aliases: ['floodZone', 'fema_flood_zone', 'femaFloodZone'],
    encompassFieldId: 'Fields.1024',
  },
  {
    sourceKey: 'flood_insurance_required',
    displayName: 'Flood Insurance Required',
    category: 'property',
    dataType: 'boolean',
    required: false,
    description: 'Whether flood insurance is required',
    aliases: ['floodInsuranceRequired', 'flood_insurance_req', 'floodInsuranceReq'],
    encompassFieldId: 'Fields.1025',
  },
  {
    sourceKey: 'hazard_insurance_required',
    displayName: 'Hazard Insurance Required',
    category: 'property',
    dataType: 'boolean',
    required: false,
    description: 'Whether hazard insurance is required',
    aliases: ['hazardInsuranceRequired', 'hazard_insurance_req', 'hazardInsuranceReq', 'homeowners_insurance', 'homeownersInsurance'],
    encompassFieldId: 'Fields.1026',
  },
];

/**
 * Find field by alias (case-insensitive, fuzzy matching)
 */
export function findFieldByAlias(alias: string): LOSField | undefined {
  const normalizedAlias = alias.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
  
  // First try exact match
  for (const field of LOS_FIELD_LIBRARY) {
    if (field.sourceKey.toLowerCase() === normalizedAlias) return field;
    if (field.displayName.toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedAlias) return field;
    if (field.aliases?.some(a => a.toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedAlias)) return field;
  }
  
  // Try partial/fuzzy matching
  for (const field of LOS_FIELD_LIBRARY) {
    const sourceKeyNorm = field.sourceKey.toLowerCase().replace(/[^a-z0-9]/g, '');
    const displayNameNorm = field.displayName.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    // Check if alias contains key parts or vice versa
    if (sourceKeyNorm.includes(normalizedAlias) || normalizedAlias.includes(sourceKeyNorm)) {
      return field;
    }
    if (displayNameNorm.includes(normalizedAlias) || normalizedAlias.includes(displayNameNorm)) {
      return field;
    }
    
    // Check aliases
    if (field.aliases) {
      for (const fieldAlias of field.aliases) {
        const aliasNorm = fieldAlias.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (aliasNorm.includes(normalizedAlias) || normalizedAlias.includes(aliasNorm)) {
          return field;
        }
      }
    }
  }
  
  return undefined;
}

/**
 * Calculate similarity score between two strings (0-1)
 */
function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().replace(/[^a-z0-9]/g, '');
  const s2 = str2.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  if (s1 === s2) return 1.0;
  if (s1.includes(s2) || s2.includes(s1)) return 0.8;
  
  // Simple Levenshtein-like scoring
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  const editDistance = getEditDistance(longer, shorter);
  return 1 - (editDistance / longer.length);
}

function getEditDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[str2.length][str1.length];
}
