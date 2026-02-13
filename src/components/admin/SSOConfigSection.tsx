import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { 
  Shield, 
  Key,
  Upload,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  ExternalLink,
  Copy,
  Eye,
  EyeOff,
  FileText,
  Clock,
  User,
  Settings2,
  Zap,
  Link2,
  RotateCcw
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useAdminTenant } from '@/contexts/AdminTenantContext';

/**
 * SSO Provider types supported
 */
type SSOProvider = 'saml' | 'oidc' | 'azure_ad' | 'okta' | 'google' | 'coheus_bridge';

/**
 * SSO Configuration interface
 */
interface SSOConfig {
  id: string;
  tenant_id: string;
  provider: SSOProvider;
  is_enabled: boolean;
  is_primary: boolean;
  
  // SAML specific
  idp_entity_id?: string;
  idp_sso_url?: string;
  idp_slo_url?: string;
  idp_certificate?: string;
  
  // OIDC specific
  oidc_client_id?: string;
  oidc_client_secret?: string;
  oidc_issuer_url?: string;
  oidc_scopes?: string[];
  
  // Attribute mapping
  attribute_mapping: AttributeMapping;
  
  // Metadata
  sp_entity_id?: string;
  sp_acs_url?: string;
  sp_slo_url?: string;
  sp_metadata_url?: string;
  
  // Status
  last_test_at?: string;
  last_test_status?: 'success' | 'failed';
  last_test_error?: string;
  
  created_at: string;
  updated_at: string;
}

/**
 * Attribute mapping from IdP to Cohi fields
 */
interface AttributeMapping {
  email: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  role?: string;
  branch_code?: string;
  employee_id?: string;
}

/**
 * SSO login history entry
 */
interface SSOLoginEntry {
  id: string;
  user_email: string;
  user_name?: string;
  provider: SSOProvider;
  status: 'success' | 'failed';
  error_message?: string;
  ip_address?: string;
  user_agent?: string;
  created_at: string;
}

// Provider display info
const PROVIDERS = {
  saml: { name: 'SAML 2.0', icon: Shield, color: 'text-blue-500' },
  oidc: { name: 'OpenID Connect', icon: Key, color: 'text-purple-500' },
  azure_ad: { name: 'Azure AD', icon: Shield, color: 'text-sky-500' },
  okta: { name: 'Okta', icon: Shield, color: 'text-indigo-500' },
  google: { name: 'Google Workspace', icon: Shield, color: 'text-red-500' },
  coheus_bridge: { name: 'Coheus Bridge', icon: Link2, color: 'text-orange-500', description: 'SSO via existing Coheus Qlik Sense session' }
};

// Default attribute names for common IdPs
const DEFAULT_ATTRIBUTE_NAMES: Record<SSOProvider, AttributeMapping> = {
  saml: {
    email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
    first_name: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
    last_name: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
  },
  oidc: {
    email: 'email',
    first_name: 'given_name',
    last_name: 'family_name',
  },
  azure_ad: {
    email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
    first_name: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
    last_name: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
  },
  okta: {
    email: 'email',
    first_name: 'firstName',
    last_name: 'lastName',
  },
  google: {
    email: 'email',
    first_name: 'given_name',
    last_name: 'family_name',
  },
  coheus_bridge: {
    email: 'qlik_user_email',
    full_name: 'qlik_user_name',
  }
};

export function SSOConfigSection() {
  const { user } = useAuth();
  const { toast } = useToast();
  
  // Use admin tenant context
  const { selectedTenantId, isTenantAdmin, isPlatformAdmin } = useAdminTenant();
  
  // State
  const [config, setConfig] = useState<SSOConfig | null>(null);
  const [loginHistory, setLoginHistory] = useState<SSOLoginEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  
  // Form state
  const [provider, setProvider] = useState<SSOProvider>('saml');
  const [isEnabled, setIsEnabled] = useState(false);
  const [idpMetadataXml, setIdpMetadataXml] = useState('');
  const [idpMetadataUrl, setIdpMetadataUrl] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [emailDomains, setEmailDomains] = useState<string[]>([]);
  const [newDomain, setNewDomain] = useState('');
  
  // SAML fields
  const [idpEntityId, setIdpEntityId] = useState('');
  const [idpSsoUrl, setIdpSsoUrl] = useState('');
  const [idpSloUrl, setIdpSloUrl] = useState('');
  const [idpCertificate, setIdpCertificate] = useState('');
  
  // OIDC fields
  const [oidcClientId, setOidcClientId] = useState('');
  const [oidcClientSecret, setOidcClientSecret] = useState('');
  const [oidcIssuerUrl, setOidcIssuerUrl] = useState('');
  
  // Attribute mapping
  const [attributeMapping, setAttributeMapping] = useState<AttributeMapping>({
    email: '',
    first_name: '',
    last_name: '',
    full_name: '',
    role: '',
    branch_code: '',
    employee_id: ''
  });
  
  // Dialog states
  const [metadataDialogOpen, setMetadataDialogOpen] = useState(false);
  const [testDialogOpen, setTestDialogOpen] = useState(false);

  // Load SSO config when tenant changes
  useEffect(() => {
    loadSSOConfig();
    loadLoginHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenantId]);

  // Update attribute mapping defaults when provider changes
  useEffect(() => {
    if (!config) {
      setAttributeMapping(DEFAULT_ATTRIBUTE_NAMES[provider]);
    }
  }, [provider, config]);

  const loadSSOConfig = async () => {
    setLoading(true);
    try {
      const response = await api.request(`/api/admin/sso/config${selectedTenantId ? `?tenant_id=${selectedTenantId}` : ''}`);
      
      // Map response to config
      const configs = response.configurations || [];
      const primaryConfig = configs.find((c: any) => c.is_primary) || configs[0];
      
      if (primaryConfig) {
        const mappedConfig: SSOConfig = {
          id: primaryConfig.id,
          tenant_id: primaryConfig.tenant_id,
          provider: primaryConfig.idp_type || 'saml',
          is_enabled: primaryConfig.is_enabled,
          is_primary: primaryConfig.is_primary,
          idp_entity_id: primaryConfig.config?.idp_entity_id,
          idp_sso_url: primaryConfig.config?.idp_sso_url,
          idp_slo_url: primaryConfig.config?.idp_slo_url,
          idp_certificate: primaryConfig.config?.idp_certificate,
          oidc_client_id: primaryConfig.config?.oidc_client_id,
          oidc_issuer_url: primaryConfig.config?.oidc_issuer_url,
          sp_entity_id: response.sp_info?.entity_id,
          sp_acs_url: response.sp_info?.acs_url,
          sp_slo_url: response.sp_info?.slo_url,
          sp_metadata_url: response.sp_info?.metadata_url,
          attribute_mapping: primaryConfig.config?.attribute_mapping || DEFAULT_ATTRIBUTE_NAMES[primaryConfig.idp_type || 'saml'],
          created_at: primaryConfig.created_at,
          updated_at: primaryConfig.updated_at,
        };
        
        setConfig(mappedConfig);
        setProvider(mappedConfig.provider);
        setIsEnabled(mappedConfig.is_enabled);
        setAttributeMapping(mappedConfig.attribute_mapping);
        setEmailDomains(primaryConfig.email_domains || []);
        
        if (mappedConfig.idp_entity_id) setIdpEntityId(mappedConfig.idp_entity_id);
        if (mappedConfig.idp_sso_url) setIdpSsoUrl(mappedConfig.idp_sso_url);
        if (mappedConfig.idp_slo_url) setIdpSloUrl(mappedConfig.idp_slo_url);
        if (mappedConfig.oidc_client_id) setOidcClientId(mappedConfig.oidc_client_id);
        if (mappedConfig.oidc_issuer_url) setOidcIssuerUrl(mappedConfig.oidc_issuer_url);
      } else {
        // No config exists, use defaults from SP info
        const defaultConfig: SSOConfig = {
          id: '',
          tenant_id: selectedTenantId || '',
          provider: 'saml',
          is_enabled: false,
          is_primary: true,
          sp_entity_id: response.sp_info?.entity_id,
          sp_acs_url: response.sp_info?.acs_url,
          sp_slo_url: response.sp_info?.slo_url,
          sp_metadata_url: response.sp_info?.metadata_url,
          attribute_mapping: DEFAULT_ATTRIBUTE_NAMES['saml'],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        setConfig(defaultConfig);
        setIsEnabled(false);
      }
    } catch (error: any) {
      console.error('Failed to load SSO config:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to load SSO configuration',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const loadLoginHistory = async () => {
    try {
      const response = await api.request(`/api/admin/sso/history${selectedTenantId ? `?tenant_id=${selectedTenantId}` : ''}`);
      setLoginHistory(response.history || []);
    } catch (error: any) {
      console.error('Failed to load login history:', error);
      // Don't show error toast for history - it's non-critical
    }
  };

  const handleSaveConfig = async () => {
    // Validate email domains
    if (emailDomains.length === 0) {
      toast({
        title: 'Validation Error',
        description: 'At least one email domain is required for SSO',
        variant: 'destructive'
      });
      return;
    }
    
    setSaving(true);
    try {
      const payload: any = {
        provider_type: provider,
        email_domains: emailDomains,
        is_enabled: isEnabled,
        attribute_mapping: attributeMapping,
      };
      
      // Add SAML config
      if (provider === 'saml' || provider === 'azure_ad' || provider === 'okta') {
        if (idpMetadataUrl) {
          payload.metadata_url = idpMetadataUrl;
        } else if (idpMetadataXml) {
          payload.metadata_xml = idpMetadataXml;
        } else if (!idpEntityId) {
          toast({
            title: 'Validation Error',
            description: 'Please provide IdP metadata (URL or XML)',
            variant: 'destructive'
          });
          setSaving(false);
          return;
        }
      }
      
      // Add OIDC config
      if (provider === 'oidc' || provider === 'google') {
        payload.oidc_client_id = oidcClientId;
        payload.oidc_client_secret = oidcClientSecret;
        payload.oidc_issuer_url = oidcIssuerUrl;
      }
      
      await api.request(`/api/admin/sso/config${selectedTenantId ? `?tenant_id=${selectedTenantId}` : ''}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      
      toast({
        title: 'Success',
        description: 'SSO configuration saved successfully. Users with the specified email domains can now sign in via SSO.'
      });
      
      loadSSOConfig();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save SSO configuration',
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!config?.id) {
      toast({
        title: 'Error',
        description: 'Please save the configuration first before testing',
        variant: 'destructive'
      });
      return;
    }
    
    setTesting(true);
    try {
      const response = await api.request('/api/admin/sso/test', {
        method: 'POST',
        body: JSON.stringify({ config_id: config.id }),
      });
      
      // Open test URL in new window
      if (response.test_url) {
        window.open(response.test_url, '_blank', 'width=500,height=600');
        toast({
          title: 'Test Initiated',
          description: 'Complete the sign-in process in the new window to verify the connection.'
        });
      }
      
      setTestDialogOpen(false);
    } catch (error: any) {
      toast({
        title: 'Test Failed',
        description: error.message || 'SSO connection test failed',
        variant: 'destructive'
      });
    } finally {
      setTesting(false);
    }
  };

  const handleToggleSSO = async (enabled: boolean) => {
    setSaving(true);
    try {
      const mode = enabled ? 'hybrid' : 'password_only';
      await api.request(`/api/admin/sso/auth-mode${selectedTenantId ? `?tenant_id=${selectedTenantId}` : ''}`, {
        method: 'PUT',
        body: JSON.stringify({ mode, allow_email_password: true }),
      });
      
      setIsEnabled(enabled);
      toast({
        title: enabled ? 'SSO Enabled' : 'SSO Disabled',
        description: enabled 
          ? 'Users can now sign in using SSO (hybrid mode — password login also available)' 
          : 'SSO has been disabled. Users must use password authentication.'
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update SSO status',
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleUploadMetadata = async () => {
    if (!idpMetadataXml && !idpMetadataUrl) {
      toast({
        title: 'Validation Error',
        description: 'Please provide either metadata XML or a metadata URL',
        variant: 'destructive'
      });
      return;
    }

    // Validate email domains before saving
    if (emailDomains.length === 0) {
      toast({
        title: 'Validation Error',
        description: 'Please add at least one email domain before uploading metadata',
        variant: 'destructive'
      });
      return;
    }

    setSaving(true);
    try {
      // Send metadata to backend — it will parse, create Cognito IdP, and save config
      const payload: any = {
        provider_type: provider,
        email_domains: emailDomains,
        is_enabled: isEnabled,
        attribute_mapping: attributeMapping,
      };

      if (idpMetadataUrl) {
        payload.metadata_url = idpMetadataUrl;
      } else if (idpMetadataXml) {
        payload.metadata_xml = idpMetadataXml;
      }

      const response = await api.request(`/api/admin/sso/config${selectedTenantId ? `?tenant_id=${selectedTenantId}` : ''}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      
      toast({
        title: 'Success',
        description: 'IdP metadata uploaded and SSO configured successfully'
      });
      
      setMetadataDialogOpen(false);
      // Clear metadata inputs after successful upload
      setIdpMetadataUrl('');
      setIdpMetadataXml('');
      loadSSOConfig();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to upload metadata. Ensure the URL is HTTPS and publicly accessible.',
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadSPMetadata = () => {
    // Generate and download SP metadata XML using Cognito's SAML endpoint values
    const metadata = `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${config?.sp_entity_id}">
  <SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat>
    <AssertionConsumerService 
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" 
      Location="${config?.sp_acs_url}" 
      index="0" 
      isDefault="true"/>
  </SPSSODescriptor>
</EntityDescriptor>`;

    const blob = new Blob([metadata], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cohi-sp-metadata.xml';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    toast({
      title: 'Downloaded',
      description: 'SP metadata file downloaded successfully'
    });
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: 'Copied',
      description: `${label} copied to clipboard`
    });
  };

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-center h-64"
      >
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-light text-slate-900 dark:text-white">
            SSO Configuration
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Configure Single Sign-On for your organization
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600 dark:text-slate-400">SSO Enabled</span>
            <Switch
              checked={isEnabled}
              onCheckedChange={handleToggleSSO}
              disabled={saving || !config?.idp_entity_id}
            />
          </div>
        </div>
      </div>

      {/* Status Card */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-lg ${
                isEnabled 
                  ? 'bg-emerald-100 dark:bg-emerald-900/30' 
                  : 'bg-slate-100 dark:bg-slate-800'
              }`}>
                {isEnabled ? (
                  <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <AlertCircle className="h-6 w-6 text-slate-400" />
                )}
              </div>
              <div>
                <h3 className="font-medium text-slate-900 dark:text-white">
                  {isEnabled ? 'SSO is Active' : 'SSO is Not Configured'}
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {isEnabled 
                    ? `Using ${PROVIDERS[provider].name} for authentication`
                    : 'Configure an identity provider below to enable SSO'
                  }
                </p>
              </div>
            </div>
            {config?.last_test_at && (
              <div className="text-right text-sm">
                <p className="text-slate-500 dark:text-slate-400">Last tested</p>
                <p className={config.last_test_status === 'success' ? 'text-emerald-600' : 'text-rose-600'}>
                  {new Date(config.last_test_at).toLocaleDateString()}
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="provider" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="provider">Provider</TabsTrigger>
          <TabsTrigger value="mapping">Attribute Mapping</TabsTrigger>
          <TabsTrigger value="sp-info">SP Information</TabsTrigger>
          <TabsTrigger value="history">Login History</TabsTrigger>
        </TabsList>

        {/* Provider Tab */}
        <TabsContent value="provider" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Identity Provider</CardTitle>
              <CardDescription>
                Select and configure your identity provider
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Provider Selection */}
              <div className="space-y-2">
                <Label>Provider Type</Label>
                <Select value={provider} onValueChange={(v: SSOProvider) => setProvider(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PROVIDERS).map(([key, info]) => (
                      <SelectItem key={key} value={key}>
                        <div className="flex items-center gap-2">
                          <info.icon className={`h-4 w-4 ${info.color}`} />
                          <span>{info.name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {PROVIDERS[provider].description && (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {PROVIDERS[provider].description}
                  </p>
                )}
              </div>

              {/* Email Domains - Required for SSO routing */}
              <div className="space-y-2 p-4 border rounded-lg bg-slate-50 dark:bg-slate-800/50">
                <Label className="text-base font-medium">Email Domains *</Label>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
                  Users with email addresses from these domains will be routed to this SSO provider.
                </p>
                <div className="flex gap-2 mb-2">
                  <Input
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value.toLowerCase())}
                    placeholder="e.g., yourcompany.com"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newDomain) {
                        e.preventDefault();
                        if (!emailDomains.includes(newDomain)) {
                          setEmailDomains([...emailDomains, newDomain]);
                        }
                        setNewDomain('');
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (newDomain && !emailDomains.includes(newDomain)) {
                        setEmailDomains([...emailDomains, newDomain]);
                        setNewDomain('');
                      }
                    }}
                  >
                    Add
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {emailDomains.map((domain) => (
                    <Badge key={domain} variant="secondary" className="px-3 py-1">
                      {domain}
                      <button
                        type="button"
                        className="ml-2 hover:text-rose-600"
                        onClick={() => setEmailDomains(emailDomains.filter(d => d !== domain))}
                      >
                        ×
                      </button>
                    </Badge>
                  ))}
                  {emailDomains.length === 0 && (
                    <span className="text-sm text-slate-400 italic">No domains added yet</span>
                  )}
                </div>
              </div>

              {/* Coheus Bridge Info */}
              {provider === 'coheus_bridge' && (
                <Alert>
                  <Link2 className="h-4 w-4" />
                  <AlertTitle>Coheus Bridge SSO</AlertTitle>
                  <AlertDescription>
                    This option allows users to sign into Cohi using their existing Coheus (Qlik Sense) session.
                    When a user accesses Cohi from within Coheus, they will be automatically authenticated.
                  </AlertDescription>
                </Alert>
              )}

              {/* SAML Configuration */}
              {(provider === 'saml' || provider === 'azure_ad' || provider === 'okta') && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label>IdP Metadata</Label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setMetadataDialogOpen(true)}
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Upload Metadata
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="idpEntityId">Entity ID</Label>
                    <Input
                      id="idpEntityId"
                      value={idpEntityId}
                      onChange={(e) => setIdpEntityId(e.target.value)}
                      placeholder="e.g., https://idp.example.com/metadata"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="idpSsoUrl">SSO URL (Sign-in)</Label>
                    <Input
                      id="idpSsoUrl"
                      value={idpSsoUrl}
                      onChange={(e) => setIdpSsoUrl(e.target.value)}
                      placeholder="e.g., https://idp.example.com/sso"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="idpSloUrl">SLO URL (Sign-out) - Optional</Label>
                    <Input
                      id="idpSloUrl"
                      value={idpSloUrl}
                      onChange={(e) => setIdpSloUrl(e.target.value)}
                      placeholder="e.g., https://idp.example.com/slo"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="idpCertificate">X.509 Certificate</Label>
                    <Textarea
                      id="idpCertificate"
                      value={idpCertificate}
                      onChange={(e) => setIdpCertificate(e.target.value)}
                      placeholder="Paste the IdP's X.509 certificate (PEM format)"
                      rows={4}
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
              )}

              {/* OIDC Configuration */}
              {(provider === 'oidc' || provider === 'google') && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="oidcIssuerUrl">Issuer URL</Label>
                    <Input
                      id="oidcIssuerUrl"
                      value={oidcIssuerUrl}
                      onChange={(e) => setOidcIssuerUrl(e.target.value)}
                      placeholder="e.g., https://accounts.google.com"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="oidcClientId">Client ID</Label>
                    <Input
                      id="oidcClientId"
                      value={oidcClientId}
                      onChange={(e) => setOidcClientId(e.target.value)}
                      placeholder="Your OAuth client ID"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="oidcClientSecret">Client Secret</Label>
                    <div className="relative">
                      <Input
                        id="oidcClientSecret"
                        type={showSecret ? 'text' : 'password'}
                        value={oidcClientSecret}
                        onChange={(e) => setOidcClientSecret(e.target.value)}
                        placeholder="Your OAuth client secret"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute right-2 top-1/2 -translate-y-1/2"
                        onClick={() => setShowSecret(!showSecret)}
                      >
                        {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-between pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => setTestDialogOpen(true)}
                  disabled={!idpEntityId && !oidcIssuerUrl && provider !== 'coheus_bridge'}
                >
                  <Zap className="h-4 w-4 mr-2" />
                  Test Connection
                </Button>
                <Button onClick={handleSaveConfig} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Save Configuration
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Attribute Mapping Tab */}
        <TabsContent value="mapping" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Attribute Mapping</CardTitle>
              <CardDescription>
                Map IdP attributes to Cohi user fields
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <Settings2 className="h-4 w-4" />
                <AlertDescription>
                  Configure how attributes from your identity provider map to user fields in Cohi.
                  The values should match the attribute names sent by your IdP.
                </AlertDescription>
              </Alert>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="mapEmail">Email *</Label>
                  <Input
                    id="mapEmail"
                    value={attributeMapping.email}
                    onChange={(e) => setAttributeMapping(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="e.g., email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mapFirstName">First Name</Label>
                  <Input
                    id="mapFirstName"
                    value={attributeMapping.first_name || ''}
                    onChange={(e) => setAttributeMapping(prev => ({ ...prev, first_name: e.target.value }))}
                    placeholder="e.g., given_name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mapLastName">Last Name</Label>
                  <Input
                    id="mapLastName"
                    value={attributeMapping.last_name || ''}
                    onChange={(e) => setAttributeMapping(prev => ({ ...prev, last_name: e.target.value }))}
                    placeholder="e.g., family_name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mapFullName">Full Name (alternative)</Label>
                  <Input
                    id="mapFullName"
                    value={attributeMapping.full_name || ''}
                    onChange={(e) => setAttributeMapping(prev => ({ ...prev, full_name: e.target.value }))}
                    placeholder="e.g., displayName"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mapRole">Role (optional)</Label>
                  <Input
                    id="mapRole"
                    value={attributeMapping.role || ''}
                    onChange={(e) => setAttributeMapping(prev => ({ ...prev, role: e.target.value }))}
                    placeholder="e.g., groups"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mapBranch">Branch Code (optional)</Label>
                  <Input
                    id="mapBranch"
                    value={attributeMapping.branch_code || ''}
                    onChange={(e) => setAttributeMapping(prev => ({ ...prev, branch_code: e.target.value }))}
                    placeholder="e.g., branch"
                  />
                </div>
              </div>

              <div className="pt-4 border-t flex justify-end">
                <Button
                  variant="outline"
                  className="mr-2"
                  onClick={() => setAttributeMapping(DEFAULT_ATTRIBUTE_NAMES[provider])}
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Reset to Defaults
                </Button>
                <Button onClick={handleSaveConfig} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Save Mapping
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SP Information Tab */}
        <TabsContent value="sp-info" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Service Provider Information</CardTitle>
              <CardDescription>
                Provide these values to the client's IT team when they configure Cohi in their Identity Provider (Entra, CyberArk, etc.)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <Shield className="h-4 w-4" />
                <AlertDescription>
                  These values point to your Cognito User Pool. They are the same for all tenants — each tenant is differentiated by their own IdP configuration within the pool.
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <Label>Entity ID / Audience URI (Identifier)</Label>
                <div className="flex items-center gap-2">
                  <Input value={config?.sp_entity_id || ''} readOnly className="font-mono text-sm" />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard(config?.sp_entity_id || '', 'Entity ID')}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-slate-500">In Entra: "Identifier (Entity ID)". In CyberArk: "SP Entity ID / Audience".</p>
              </div>

              <div className="space-y-2">
                <Label>Reply URL / ACS URL (Assertion Consumer Service)</Label>
                <div className="flex items-center gap-2">
                  <Input value={config?.sp_acs_url || ''} readOnly className="font-mono text-sm" />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard(config?.sp_acs_url || '', 'ACS URL')}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-slate-500">In Entra: "Reply URL (Assertion Consumer Service URL)". In CyberArk: "SP ACS URL".</p>
              </div>

              <div className="space-y-2">
                <Label>Name ID Format</Label>
                <div className="flex items-center gap-2">
                  <Input value="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" readOnly className="font-mono text-sm" />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard('urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress', 'Name ID Format')}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-slate-500">The IdP should send the user's email address as the Name ID.</p>
              </div>

              <div className="pt-4 border-t flex items-center gap-3">
                <Button variant="outline" onClick={handleDownloadSPMetadata}>
                  <Download className="h-4 w-4 mr-2" />
                  Download SP Metadata XML
                </Button>
                <p className="text-sm text-slate-500">Or provide the values above manually to the client's IT team.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Login History Tab */}
        <TabsContent value="history" className="space-y-6 mt-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">SSO Login History</CardTitle>
                <CardDescription>
                  Recent SSO login attempts for troubleshooting
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={loadLoginHistory}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>IP Address</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loginHistory.map(entry => (
                    <TableRow key={entry.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{entry.user_name || 'Unknown'}</p>
                          <p className="text-sm text-slate-500">{entry.user_email}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {PROVIDERS[entry.provider]?.name || entry.provider}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {entry.status === 'success' ? (
                          <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Success
                          </Badge>
                        ) : (
                          <Badge variant="destructive">
                            <AlertCircle className="h-3 w-3 mr-1" />
                            Failed
                          </Badge>
                        )}
                        {entry.error_message && (
                          <p className="text-xs text-rose-600 mt-1">{entry.error_message}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-slate-500">{entry.ip_address}</TableCell>
                      <TableCell className="text-slate-500">
                        {new Date(entry.created_at).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                  {loginHistory.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-slate-500">
                        No login history found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Upload Metadata Dialog */}
      <Dialog open={metadataDialogOpen} onOpenChange={setMetadataDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload IdP Metadata</DialogTitle>
            <DialogDescription>
              Provide your Identity Provider's metadata to auto-configure SSO settings
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="url" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="url">From URL</TabsTrigger>
              <TabsTrigger value="xml">Paste XML</TabsTrigger>
            </TabsList>
            <TabsContent value="url" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Metadata URL</Label>
                <Input
                  value={idpMetadataUrl}
                  onChange={(e) => setIdpMetadataUrl(e.target.value)}
                  placeholder="https://idp.example.com/metadata"
                />
              </div>
            </TabsContent>
            <TabsContent value="xml" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Metadata XML</Label>
                <Textarea
                  value={idpMetadataXml}
                  onChange={(e) => setIdpMetadataXml(e.target.value)}
                  placeholder="Paste the full XML metadata here"
                  rows={10}
                  className="font-mono text-xs"
                />
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => setMetadataDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUploadMetadata} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Upload & Parse
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Test Connection Dialog */}
      <Dialog open={testDialogOpen} onOpenChange={setTestDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Test SSO Connection</DialogTitle>
            <DialogDescription>
              This will attempt to initiate an SSO login flow to verify your configuration
            </DialogDescription>
          </DialogHeader>

          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              A new browser window will open. Complete the sign-in process in your IdP to test the connection.
            </AlertDescription>
          </Alert>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTestDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleTestConnection} disabled={testing}>
              {testing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Testing...
                </>
              ) : (
                <>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Start Test
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

export default SSOConfigSection;
