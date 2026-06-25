import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AnimateOnView } from '../../components/AnimateOnView';
import { motion, AnimatePresence } from 'framer-motion';
import {
  fetchDepartmentContacts,
  fetchRequestTypes,
  fetchComplaintCategories,
  fetchStudentRequests,
  fetchMyComplaints,
  submitSupportRequest,
  submitComplaint,
  editSupportRequest,
  editComplaint,
  getStatusColor,
  formatRequestDate,
  DepartmentContact,
  RequestType,
  ComplaintCategory,
  SupportRequest,
  RequestSummary
} from '../../utils/studentAffairsService';
import { GlassDropdown } from '../../components/GlassDropdown';
import { useMatchHeight } from '../../hooks/useMatchHeight';
import { useAppContext } from '../../context/AppContext';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/30 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-lg";

const StudentAffairs: React.FC = () => {
  const { searchTerm } = useAppContext();
  const t = useT();
  const [contacts, setContacts] = useState<DepartmentContact[]>([]);
  const [requestTypes, setRequestTypes] = useState<RequestType[]>([]);
  const [complaintCategories, setComplaintCategories] = useState<ComplaintCategory[]>([]);
  const [myRequests, setMyRequests] = useState<SupportRequest[]>([]);
  const [myComplaints, setMyComplaints] = useState<SupportRequest[]>([]);
  const [requestSummary, setRequestSummary] = useState<RequestSummary>({ total: 0, pending: 0, inProgress: 0, completed: 0 });
  // Per-row inline edit state for the My Requests / Complaints panel.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ subject: string; message: string }>({ subject: '', message: '' });
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  // SA-managed taxonomy filter for the My Requests list. Defaults to All.
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showMyRequests, setShowMyRequests] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Track Quick Links' natural height so Department Contacts can match it.
  const [quickLinksRef, quickLinksHeight] = useMatchHeight<HTMLDivElement>();

  // Submission mode — Request or Complaint. Toggled by the pill bar at the
  // top of the form. Each mode targets a different backend endpoint and
  // shows a different "type/category" dropdown.
  const [submitMode, setSubmitMode] = useState<'request' | 'complaint'>('request');
  const [complaintCategory, setComplaintCategory] = useState<string>('');

  // Form state
  const [formData, setFormData] = useState({
    studentId: localStorage.getItem('currentUserId') || '',
    studentName: `${localStorage.getItem('currentUserFirstName') || ''} ${localStorage.getItem('currentUserLastName') || ''}`.trim(),
    studentEmail: localStorage.getItem('currentUserEmail') || '',
    type: 'transcript',
    subject: '',
    message: '',
    priority: 'medium' as 'low' | 'medium' | 'high'
  });
  const [attachments, setAttachments] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const userId = localStorage.getItem('currentUserId') || '';

  const reloadMyItems = useCallback(async () => {
    const [requestsData, complaintsData] = await Promise.all([
      fetchStudentRequests(userId),
      fetchMyComplaints(),
    ]);
    setMyRequests((requestsData.requests || []).map((r) => ({ ...r, kind: 'request' as const })));
    setMyComplaints((complaintsData.complaints || []).map((c) => ({ ...c, kind: 'complaint' as const })));
    // Combined summary so the pill counters reflect the entire feed.
    const merged: RequestSummary = {
      total: (requestsData.summary?.total || 0) + (complaintsData.summary?.total || 0),
      pending: (requestsData.summary?.pending || 0) + (complaintsData.summary?.pending || 0),
      inProgress: (requestsData.summary?.inProgress || 0) + (complaintsData.summary?.inProgress || 0),
      completed: (requestsData.summary?.completed || 0) + (complaintsData.summary?.completed || 0),
    };
    setRequestSummary(merged);
  }, [userId]);

  // Live-update bridge — NotificationContext dispatches `uniflow:sa-item-updated`
  // whenever a notification with referenceType=SupportRequest|Complaint lands
  // (i.e. SA marked the row as processing/resolved/rejected). Re-fetch both
  // feeds so the In Progress counter and the processor banner refresh
  // without the student touching the page.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => { reloadMyItems(); };
    window.addEventListener('uniflow:sa-item-updated', handler);
    return () => window.removeEventListener('uniflow:sa-item-updated', handler);
  }, [reloadMyItems]);

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        const [contactsData, typesData, categoriesData] = await Promise.all([
          fetchDepartmentContacts(),
          fetchRequestTypes(),
          fetchComplaintCategories(),
        ]);
        setContacts(contactsData);
        setRequestTypes(typesData);
        setComplaintCategories(categoriesData);
        if (categoriesData.length > 0) {
          setComplaintCategory(categoriesData[0].categoryKey);
        }
        await reloadMyItems();
      } catch (error) {
        console.error('Error loading data:', error);
      }
      setIsLoading(false);
    };

    loadData();
    // Mount-only fetch; reloadMyItems is defined in component body.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startEdit = (item: SupportRequest) => {
    setEditingId(item.id);
    setEditDraft({ subject: item.subject || '', message: item.message || '' });
    setEditError(null);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditError(null);
  };
  const saveEdit = async (item: SupportRequest) => {
    setEditSaving(true);
    setEditError(null);
    const fn = item.kind === 'complaint' ? editComplaint : editSupportRequest;
    const result = await fn(item.id, { subject: editDraft.subject, message: editDraft.message });
    if (!result.success) {
      setEditError(result.message || 'Failed to save changes.');
      setEditSaving(false);
      return;
    }
    await reloadMyItems();
    setEditingId(null);
    setEditSaving(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setAttachments(prev => [...prev, ...newFiles].slice(0, 5)); // Max 5 files
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitSuccess(null);
    setSubmitError(null);

    if (!formData.subject.trim() || !formData.message.trim()) {
      setSubmitError('Please fill in all required fields.');
      setIsSubmitting(false);
      return;
    }

    if (submitMode === 'complaint') {
      // Complaint flow: severity uses the same low/medium/high picker as
      // the request flow. The schema accepts low|medium|high|urgent — no
      // mapping needed for the values we send.
      const result = await submitComplaint(
        {
          category: complaintCategory,
          subject: formData.subject,
          message: formData.message,
          severity: formData.priority,
        },
        attachments,
      );
      if (result.success) {
        setSubmitSuccess('Complaint submitted to Student Affairs.');
        setFormData((prev) => ({ ...prev, subject: '', message: '' }));
        setAttachments([]);
        await reloadMyItems();
      } else {
        setSubmitError(result.message);
      }
      setIsSubmitting(false);
      return;
    }

    const result = await submitSupportRequest(formData, attachments);

    if (result.success) {
      setSubmitSuccess(`Request ${result.request?.id} submitted successfully! Estimated response time: ${result.request?.estimatedDays} business days.`);
      // Reset form
      setFormData(prev => ({ ...prev, subject: '', message: '' }));
      setAttachments([]);
      await reloadMyItems();
    } else {
      setSubmitError(result.message);
    }

    setIsSubmitting(false);
  };

  return (
    <div className="pb-16 space-y-8">
      <AnimateOnView>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-black dark:text-white text-3xl font-bold mb-2">{t('studentAffairsPage.title')}</h2>
            <p className="text-gray-600 dark:text-gray-400">{t('studentAffairsPage.subtitle')}</p>
          </div>
          <button
            onClick={() => setShowMyRequests(!showMyRequests)}
            className={`flex items-center gap-2 px-5 py-3 rounded-xl font-medium transition-all ${showMyRequests
              ? 'bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white shadow-lg shadow-purple-500/20'
              : 'bg-white/30 dark:bg-black/20 text-gray-600 dark:text-gray-400 hover:bg-white/50 dark:hover:bg-black/30 border border-white/20 dark:border-white/10'
              }`}
          >
            <i className="ph-bold ph-list-checks"></i>
            My Requests / Complaints
            {requestSummary.total > 0 && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${showMyRequests ? 'bg-white/20' : 'bg-[#6A3FF4]/20 text-[#6A3FF4]'}`}>
                {requestSummary.total}
              </span>
            )}
          </button>
        </div>
      </AnimateOnView>

      {/* My Requests Section */}
      <AnimatePresence>
        {showMyRequests && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <AnimateOnView>
              <div className={`${glassCardStyle} p-6`}>
                <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
                  <h2 className="text-xl font-bold text-black dark:text-white flex items-center">
                    <i className="ph-bold ph-list-checks mr-2 text-[#6A3FF4]"></i> My Requests / Complaints
                  </h2>
                  <div className="flex gap-2 text-sm">
                    <span className="px-3 py-1 bg-yellow-500/20 text-yellow-500 rounded-full">{requestSummary.pending} Pending</span>
                    <span className="px-3 py-1 bg-blue-500/20 text-blue-500 rounded-full">{requestSummary.inProgress} In Progress</span>
                    <span className="px-3 py-1 bg-green-500/20 text-green-500 rounded-full">{requestSummary.completed} Completed</span>
                  </div>
                </div>

                {/* Category filter — single dropdown listing every active SA-managed
                    request type. Lets the student narrow My Requests by what kind
                    of request it was without re-typing in the search box. */}
                <div className="mb-4 flex items-center gap-3 flex-wrap">
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-500">{t('studentAffairsPage.filterByCategory')}</span>
                  <div className="min-w-[220px]">
                    <GlassDropdown
                      value={categoryFilter}
                      onChange={setCategoryFilter}
                      options={[
                        { value: 'all', label: t('studentAffairsPage.allCategories'), icon: 'ph-funnel' },
                        ...requestTypes.map((rt) => ({
                          value: rt.id,
                          label: rt.name,
                          icon: 'ph-file-text',
                        })),
                      ]}
                      direction="up"
                      className="w-full"
                    />
                  </div>
                  {categoryFilter !== 'all' && (
                    <button
                      onClick={() => setCategoryFilter('all')}
                      className="text-xs text-gray-500 hover:text-[#6A3FF4] underline"
                    >
                      Clear filter
                    </button>
                  )}
                </div>

                {(() => {
                  // Merge requests + complaints into one list, sorted newest first.
                  const merged = [...myRequests, ...myComplaints].sort(
                    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
                  );
                  // SA-defined request type filter ignores complaints (they have
                  // their own taxonomy). When a request type is picked, hide complaints.
                  const byCategory = categoryFilter === 'all'
                    ? merged
                    : merged.filter((r) => r.kind !== 'complaint' && r.type === categoryFilter);
                  const visibleItems = !searchTerm
                    ? byCategory
                    : byCategory.filter((r) => {
                        const n = searchTerm.toLowerCase();
                        return (
                          r.subject?.toLowerCase().includes(n) ||
                          r.message?.toLowerCase().includes(n) ||
                          r.status?.toLowerCase().includes(n) ||
                          r.id?.toLowerCase().includes(n)
                        );
                      });
                  return visibleItems.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <i className="ph-bold ph-folder-open text-4xl mb-2 block opacity-50"></i>
                    <p>
                      {searchTerm
                        ? 'Nothing matches your search'
                        : categoryFilter !== 'all'
                          ? 'No requests in this category'
                          : 'No requests or complaints submitted yet'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {visibleItems.map((item) => {
                      const statusColor = getStatusColor(item.status);
                      const isComplaint = item.kind === 'complaint';
                      const isPending = item.statusRaw === 'pending' || item.status === 'pending';
                      const isEditing = editingId === item.id;
                      const processor = item.processedBy;
                      return (
                        <div
                          key={`${item.kind || 'request'}-${item.id}`}
                          className="p-4 bg-white/30 dark:bg-[#0d0d0d] rounded-xl border border-white/20 dark:border-[#363636] hover:border-[#6A3FF4]/50 transition-all"
                        >
                          <div className="flex justify-between items-start mb-2 flex-wrap gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${
                                  isComplaint
                                    ? 'bg-orange-500/10 text-orange-500 border border-orange-500/20'
                                    : 'bg-[#6A3FF4]/10 text-[#6A3FF4] border border-[#6A3FF4]/20'
                                }`}>
                                  <i className={`ph-bold mr-1 ${isComplaint ? 'ph-warning-circle' : 'ph-file-text'}`}></i>
                                  {isComplaint ? 'Complaint' : 'Request'}
                                </span>
                                <span className="text-xs font-mono text-gray-500">{item.id.slice(0, 8)}</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full border ${statusColor.bg} ${statusColor.text} ${statusColor.border}`}>
                                  {item.status.replace('-', ' ').charAt(0).toUpperCase() + item.status.slice(1).replace('-', ' ')}
                                </span>
                                {(item.typeName || item.type) && (
                                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-white/30 dark:bg-white/5 text-gray-500 border border-white/10">
                                    {item.typeName || item.type}
                                  </span>
                                )}
                              </div>
                              {isEditing ? (
                                <input
                                  type="text"
                                  value={editDraft.subject}
                                  onChange={(e) => setEditDraft((d) => ({ ...d, subject: e.target.value }))}
                                  className="w-full bg-white/50 dark:bg-[#0d0d0d] text-black dark:text-white rounded-lg p-2 border border-gray-300/50 dark:border-[#363636] font-bold focus:outline-none focus:ring-2 focus:ring-[#6A3FF4]"
                                />
                              ) : (
                                <h4 className="font-bold text-black dark:text-white">{item.subject}</h4>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500">{formatRequestDate(item.createdAt)}</span>
                              {isPending && !isEditing && (
                                <button
                                  onClick={() => startEdit(item)}
                                  className="p-1.5 rounded-lg bg-white/30 dark:bg-white/5 text-gray-500 hover:bg-[#6A3FF4]/20 hover:text-[#6A3FF4] transition-colors"
                                  title={t('common.edit')}
                                >
                                  <i className="ph-bold ph-pencil text-xs"></i>
                                </button>
                              )}
                            </div>
                          </div>

                          {isEditing ? (
                            <textarea
                              value={editDraft.message}
                              onChange={(e) => setEditDraft((d) => ({ ...d, message: e.target.value }))}
                              rows={3}
                              className="w-full bg-white/50 dark:bg-[#0d0d0d] text-black dark:text-white rounded-lg p-2 border border-gray-300/50 dark:border-[#363636] focus:outline-none focus:ring-2 focus:ring-[#6A3FF4] resize-none text-sm mt-2"
                            />
                          ) : (
                            <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">{item.message}</p>
                          )}

                          {/* Processor banner — appears the moment SA marks the item as processing. */}
                          {processor && (item.statusRaw === 'in_progress' || item.status === 'processing') && (
                            <div className="mt-3 p-3 bg-blue-500/10 rounded-lg border border-blue-500/20 flex items-center gap-3 flex-wrap">
                              <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-xs font-bold text-blue-500 flex-shrink-0">
                                {processor.firstName?.charAt(0) || '?'}
                              </div>
                              <div className="text-sm text-blue-600 dark:text-blue-300 min-w-0">
                                <p className="font-semibold">
                                  Being processed by {processor.firstName} {processor.lastName}
                                </p>
                                <p className="text-xs text-blue-500 truncate">
                                  {processor.email}
                                  {processor.processedAt && ` · since ${formatRequestDate(processor.processedAt)}`}
                                </p>
                              </div>
                            </div>
                          )}

                          {isEditing && (
                            <div className="mt-3 flex items-center gap-2 flex-wrap">
                              <button
                                onClick={() => saveEdit(item)}
                                disabled={editSaving}
                                className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white text-xs font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
                              >
                                {editSaving ? t('settingsPage.saving') : t('settingsPage.saveChanges')}
                              </button>
                              <button
                                onClick={cancelEdit}
                                disabled={editSaving}
                                className="px-4 py-1.5 rounded-lg bg-white/30 dark:bg-white/5 border border-white/20 text-black dark:text-white text-xs font-bold hover:bg-white/50 dark:hover:bg-white/10 transition-colors"
                              >
                                {t('common.cancel')}
                              </button>
                              {editError && (
                                <span className="text-xs text-red-400">{editError}</span>
                              )}
                            </div>
                          )}

                          {!isPending && !isEditing && (
                            <p className="mt-2 text-[10px] text-gray-500 italic">
                              <i className="ph-bold ph-lock mr-1"></i>
                              Editing locked once Student Affairs starts processing.
                            </p>
                          )}

                          {item.resolution && (
                            <div className="mt-3 p-3 bg-green-500/10 rounded-lg border border-green-500/20">
                              <p className="text-sm text-green-600 dark:text-green-400">
                                <i className="ph-bold ph-check-circle mr-1"></i>
                                {item.resolution}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
                })()}
              </div>
            </AnimateOnView>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:items-start">
        {/* Department Contacts — capped to Quick Links' height on lg+ */}
        <AnimateOnView delay={0.1}>
          <div
            className={`${glassCardStyle} p-6 flex flex-col lg:max-h-[var(--match-h,none)] lg:h-[var(--match-h,auto)]`}
            style={quickLinksHeight ? ({ ['--match-h' as string]: `${quickLinksHeight}px` } as React.CSSProperties) : undefined}
          >
            <h2 className="text-xl font-bold text-black dark:text-white mb-6 flex items-center">
              <i className="ph-bold ph-address-book mr-2 text-[#6A3FF4]"></i> Department Contacts
            </h2>
            {isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="animate-pulse p-4 bg-white/30 dark:bg-[#0d0d0d] rounded-xl">
                    <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-1/2 mb-3"></div>
                    <div className="h-3 bg-gray-300 dark:bg-gray-700 rounded w-3/4 mb-2"></div>
                    <div className="h-3 bg-gray-300 dark:bg-gray-700 rounded w-2/3"></div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-4 flex-1 min-h-0 overflow-y-auto pr-1">
                {contacts.map((contact) => (
                  <div key={contact.id} className="p-4 bg-white/30 dark:bg-[#0d0d0d] rounded-xl border border-white/20 dark:border-[#363636] hover:border-[#6A3FF4]/50 transition-all">
                    <h3 className="font-bold text-black dark:text-white mb-2">{contact.title}</h3>
                    {contact.description && (
                      <p className="text-xs text-gray-500 mb-3">{contact.description}</p>
                    )}
                    <div className="space-y-2 text-gray-600 dark:text-gray-400 text-sm">
                      <p className="flex items-center gap-3">
                        <i className="ph-bold ph-envelope text-[#6A3FF4]"></i> {contact.email}
                      </p>
                      <p className="flex items-center gap-3">
                        <i className="ph-bold ph-phone text-[#6A3FF4]"></i> {contact.phone}
                      </p>
                      <p className="flex items-center gap-3">
                        <i className="ph-bold ph-clock text-[#6A3FF4]"></i> {contact.hours}
                      </p>
                      {contact.location && (
                        <p className="flex items-center gap-3">
                          <i className="ph-bold ph-map-pin text-[#6A3FF4]"></i> {contact.location}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </AnimateOnView>

        {/* Quick Links / FAQ — original natural height; sets the height reference */}
        <div ref={quickLinksRef}>
          <AnimateOnView delay={0.2}>
            <div className={`${glassCardStyle} p-6`}>
              <h2 className="text-xl font-bold text-black dark:text-white mb-6 flex items-center">
                <i className="ph-bold ph-lightning mr-2 text-orange-400"></i> Quick Links
              </h2>
              <div className="space-y-3">
              {[
                { icon: 'ph-file-text', label: 'Request Official Transcript', desc: 'Get certified academic records', type: 'transcript' },
                { icon: 'ph-currency-dollar', label: 'Financial Aid Status', desc: 'Check your aid application', type: 'financial-aid' },
                { icon: 'ph-calendar-x', label: 'Absence Excuse', desc: 'Submit medical or emergency absence', type: 'absence-excuse' },
                { icon: 'ph-graduation-cap', label: 'Academic Appeal', desc: 'Grade or academic standing appeal', type: 'grade-appeal' },
                { icon: 'ph-wrench', label: 'IT Support', desc: 'Technical issues and account help', type: 'it-support' },
              ].map((link, index) => (
                <button
                  key={index}
                  onClick={() => {
                    setFormData(prev => ({ ...prev, type: link.type }));
                    document.getElementById('request-form')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="w-full p-4 bg-white/30 dark:bg-[#0d0d0d] rounded-xl border border-white/20 dark:border-[#363636] hover:border-[#6A3FF4]/50 hover:bg-[#6A3FF4]/5 transition-all text-left flex items-center gap-4"
                >
                  <div className="w-10 h-10 bg-[#6A3FF4]/20 rounded-xl flex items-center justify-center flex-shrink-0">
                    <i className={`ph-bold ${link.icon} text-[#6A3FF4] text-xl`}></i>
                  </div>
                  <div>
                    <h4 className="font-semibold text-black dark:text-white text-sm">{link.label}</h4>
                    <p className="text-xs text-gray-500">{link.desc}</p>
                  </div>
                  <i className="ph-bold ph-arrow-right text-gray-400 ml-auto"></i>
                </button>
              ))}
              </div>
            </div>
          </AnimateOnView>
        </div>

        {/* Submit Request Form */}
        <AnimateOnView delay={0.3} className="lg:col-span-2">
          <div id="request-form" className={`${glassCardStyle} p-6`}>
            <h2 className="text-xl font-bold text-black dark:text-white mb-2 flex items-center">
              <i className={`ph-bold mr-2 text-[#6A3FF4] ${submitMode === 'complaint' ? 'ph-warning-circle' : 'ph-paper-plane-tilt'}`}></i>
              {submitMode === 'complaint' ? 'Submit a Complaint' : t('studentAffairsPage.submitRequest')}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              {submitMode === 'complaint'
                ? 'File a complaint with Student Affairs. They will review and respond.'
                : t('studentAffairsPage.submitIntro')}
            </p>

            {/* Mode toggle — Request vs Complaint. Each routes the form to a
                different backend endpoint and swaps the type / category dropdown. */}
            <div className="inline-flex p-1 mb-6 bg-white/30 dark:bg-black/30 border border-white/20 dark:border-white/10 rounded-xl">
              <button
                type="button"
                onClick={() => { setSubmitMode('request'); setSubmitError(null); setSubmitSuccess(null); }}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                  submitMode === 'request'
                    ? 'bg-[#6A3FF4] text-white shadow-lg shadow-purple-500/20'
                    : 'text-gray-500 hover:text-black dark:hover:text-white'
                }`}
              >
                <i className="ph-bold ph-file-text"></i> Request
              </button>
              <button
                type="button"
                onClick={() => { setSubmitMode('complaint'); setSubmitError(null); setSubmitSuccess(null); }}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                  submitMode === 'complaint'
                    ? 'bg-[#6A3FF4] text-white shadow-lg shadow-purple-500/20'
                    : 'text-gray-500 hover:text-black dark:hover:text-white'
                }`}
              >
                <i className="ph-bold ph-warning-circle"></i> Complaint
              </button>
            </div>

            {/* Success/Error Messages */}
            <AnimatePresence>
              {submitSuccess && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="mb-6 p-4 bg-green-500/20 border border-green-500/30 rounded-xl flex items-center gap-3"
                >
                  <i className="ph-bold ph-check-circle text-green-500 text-xl"></i>
                  <p className="text-green-600 dark:text-green-400 text-sm">{submitSuccess}</p>
                  <button onClick={() => setSubmitSuccess(null)} className="ml-auto text-green-500 hover:text-green-600">
                    <i className="ph-bold ph-x"></i>
                  </button>
                </motion.div>
              )}
              {submitError && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="mb-6 p-4 bg-red-500/20 border border-red-500/30 rounded-xl flex items-center gap-3"
                >
                  <i className="ph-bold ph-warning text-red-500 text-xl"></i>
                  <p className="text-red-600 dark:text-red-400 text-sm">{submitError}</p>
                  <button onClick={() => setSubmitError(null)} className="ml-auto text-red-500 hover:text-red-600">
                    <i className="ph-bold ph-x"></i>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('settingsPage.studentId')}</label>
                <input
                  type="text"
                  name="studentId"
                  value={formData.studentId}
                  onChange={handleInputChange}
                  placeholder="e.g., S12345678"
                  className="w-full bg-white/50 dark:bg-[#0d0d0d] text-black dark:text-white rounded-lg p-3 border border-gray-300/50 dark:border-[#363636] focus:outline-none focus:ring-2 focus:ring-[#6A3FF4]"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {submitMode === 'complaint' ? 'Complaint Category' : 'Request Type'}
                </label>
                <div className="relative z-20">
                  {submitMode === 'complaint' ? (
                    complaintCategories.length === 0 ? (
                      <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-gray-500 italic">
                        No complaint categories configured yet.
                      </div>
                    ) : (
                      <GlassDropdown
                        value={complaintCategory}
                        onChange={setComplaintCategory}
                        options={complaintCategories.map((c) => ({
                          value: c.categoryKey,
                          label: c.description ? `${c.name} — ${c.description}` : c.name,
                          icon: c.icon || 'ph-warning',
                        }))}
                        className="w-full"
                      />
                    )
                  ) : (
                    <GlassDropdown
                      value={formData.type}
                      onChange={(val) => setFormData(prev => ({ ...prev, type: val }))}
                      options={requestTypes.map((type) => ({
                        value: type.id,
                        label: `${type.name} (${type.estimatedDays} days)`,
                        icon: 'ph-file-text'
                      }))}
                      className="w-full"
                    />
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {submitMode === 'complaint' ? 'Severity' : 'Priority'}
                </label>
                <div className="relative z-10">
                  <GlassDropdown
                    value={formData.priority}
                    onChange={(val) => setFormData(prev => ({ ...prev, priority: val as 'low' | 'medium' | 'high' }))}
                    options={[
                      { value: 'low',    label: 'Low - Non-urgent', icon: 'ph-arrow-down' },
                      { value: 'medium', label: 'Medium - Standard', icon: 'ph-minus' },
                      { value: 'high',   label: 'High - Urgent',     icon: 'ph-arrow-up' },
                    ]}
                    className="w-full"
                  />
                </div>
              </div>

              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Subject *</label>
                <input
                  type="text"
                  name="subject"
                  value={formData.subject}
                  onChange={handleInputChange}
                  placeholder={t('studentAffairsPage.subjectPlaceholder')}
                  required
                  className="w-full bg-white/50 dark:bg-[#0d0d0d] text-black dark:text-white rounded-lg p-3 border border-gray-300/50 dark:border-[#363636] focus:outline-none focus:ring-2 focus:ring-[#6A3FF4]"
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Message *</label>
                <textarea
                  name="message"
                  value={formData.message}
                  onChange={handleInputChange}
                  rows={4}
                  placeholder={t('studentAffairsPage.messagePlaceholder')}
                  required
                  className="w-full bg-white/50 dark:bg-[#0d0d0d] text-black dark:text-white rounded-lg p-3 border border-gray-300/50 dark:border-[#363636] focus:outline-none focus:ring-2 focus:ring-[#6A3FF4] resize-none"
                ></textarea>
              </div>

              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Attachments (Optional - Max 5 files)</label>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  multiple
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  className="hidden"
                />
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center justify-center border-2 border-dashed border-gray-300/50 dark:border-[#363636] rounded-lg p-6 hover:border-[#6A3FF4] hover:bg-[#6A3FF4]/5 transition-colors cursor-pointer text-gray-600 dark:text-gray-400"
                >
                  <div className="text-center">
                    <i className="ph-bold ph-upload-simple text-2xl mb-2"></i>
                    <p className="text-sm">{t('studentAffairsPage.uploadHint')}</p>
                    <p className="text-xs text-gray-400 mt-1">PDF, DOC, DOCX, JPG, PNG (max 10MB each)</p>
                  </div>
                </div>

                {/* Attached Files */}
                {attachments.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {attachments.map((file, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-3 bg-white/30 dark:bg-[#0d0d0d] rounded-lg border border-white/20 dark:border-[#363636]"
                      >
                        <div className="flex items-center gap-3">
                          <i className="ph-bold ph-file text-[#6A3FF4]"></i>
                          <span className="text-sm text-black dark:text-white truncate max-w-xs">{file.name}</span>
                          <span className="text-xs text-gray-500">({(file.size / 1024).toFixed(1)} KB)</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeAttachment(index)}
                          className="text-red-500 hover:text-red-600 p-1"
                        >
                          <i className="ph-bold ph-x"></i>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold py-3 rounded-lg hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <i className="ph-bold ph-spinner animate-spin"></i>
                      {t('studentAffairsPage.submitting')}
                    </>
                  ) : (
                    <>
                      <i className={`ph-bold ${submitMode === 'complaint' ? 'ph-warning-circle' : 'ph-paper-plane-tilt'}`}></i>
                      {submitMode === 'complaint' ? t('studentAffairsPage.submitComplaint') : t('studentAffairsPage.submitButton')}
                    </>
                  )}
                </button>
              </div>
            </form >
          </div >
        </AnimateOnView >
      </div >
    </div >
  );
};

export default StudentAffairs;
