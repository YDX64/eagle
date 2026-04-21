export type Expense = {
  id: string
  amount: number
  category: string
  description: string
  date: Date
}

export type ExpenseFormData = Omit<Expense, 'id' | 'date'> & {
  date: string
}

export const EXPENSE_CATEGORIES = [
  'Food',
  'Transportation',
  'Housing',
  'Utilities',
  'Entertainment',
  'Healthcare',
  'Shopping',
  'Education',
  'Other'
] as const

export type DateRange = {
  from: Date | undefined
  to: Date | undefined
}

export type PredictionApiData = {
  match: any;
  prediction: any;
  advancedPrediction: any;
  apiPredictions: any;
  metadata: any;
  sourceSnapshots?: {
    advancedPrediction?: any;
    [key: string]: any;
  };
}