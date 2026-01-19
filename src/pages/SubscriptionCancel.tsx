import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { XCircle, ArrowLeft, MessageSquare } from 'lucide-react';
import { motion } from 'framer-motion';
import { Navigation } from '@/components/layout/Navigation';
import { Footer } from '@/components/layout/Footer';

export const SubscriptionCancel = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50/30 via-white to-slate-50/20 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950/50">
      <Navigation />
      
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 pt-32 pb-12 max-w-2xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-8"
        >
          <div className="text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 15 }}
              className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-900/40 mb-6"
            >
              <XCircle className="h-8 w-8 text-slate-600 dark:text-slate-400" />
            </motion.div>
            <h1 className="text-3xl sm:text-4xl font-extralight text-slate-900 dark:text-white tracking-tight mb-4">
              Checkout Cancelled
            </h1>
            <p className="text-base text-slate-600 dark:text-slate-400 font-light max-w-md mx-auto">
              The checkout process was cancelled. No charges were made to your account.
            </p>
          </div>

          <Card className="border-slate-200/60 dark:border-slate-700/50 bg-white/90 dark:bg-slate-800/70 backdrop-blur-sm shadow-lg">
            <CardHeader>
              <CardTitle className="text-lg font-light text-slate-900 dark:text-white tracking-tight">
                Need Help?
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
                If you encountered any issues during checkout, our team is here to help.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => window.location.href = 'mailto:support@ailethia.com'}
              >
                <MessageSquare className="mr-2 h-4 w-4" />
                Contact Support
              </Button>
              <Button
                className="w-full"
                onClick={() => navigate('/')}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Return to Pricing
              </Button>
            </CardContent>
          </Card>

          <p className="text-xs text-slate-500 dark:text-slate-500 font-light">
            You can return to the landing page to select a different plan or deployment model.
          </p>
        </motion.div>
      </div>

      <Footer />
    </div>
  );
};

export default SubscriptionCancel;
