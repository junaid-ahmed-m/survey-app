import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, toApiError } from '../../lib/api';
import { ForwardTarget, SurveyDefinition, SurveyQuestion } from '../../lib/types';
import { formatDate } from '../../lib/format';
import { EmptyState, Modal, PageHeader } from '../../components/admin/ui';
import { FullPageLoader, Spinner } from '../../components/Spinner';
import { useAuth } from '../../lib/auth';
import { PERMISSIONS } from '../../lib/permissions';

interface SurveyListItem extends SurveyDefinition {
  questionCount: number;
  createdAt: string;
  updatedAt: string;
}

const QUESTION_TYPES: { value: SurveyQuestion['type']; label: string; hasOptions: boolean }[] = [
  { value: 'single_choice', label: 'Single choice', hasOptions: true },
  { value: 'multi_choice', label: 'Multiple choice', hasOptions: true },
  { value: 'rating', label: 'Star rating', hasOptions: false },
  { value: 'nps', label: 'NPS (0-10)', hasOptions: false },
  { value: 'text', label: 'Short text', hasOptions: false },
  { value: 'textarea', label: 'Long text', hasOptions: false },
];

const emptyQuestion = (index: number): SurveyQuestion => ({
  id: `q${index + 1}`,
  type: 'single_choice',
  label: '',
  required: true,
  options: [
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' },
  ],
});

export default function SurveysPage() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [editing, setEditing] = useState<SurveyDefinition | 'new' | null>(null);

  const canManage = can(PERMISSIONS.SURVEYS_MANAGE);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'surveys'],
    queryFn: async () => (await api.get<SurveyListItem[]>('/admin/surveys')).data,
  });

  const openEditor = async (id: string) => {
    const { data: survey } = await api.get<SurveyDefinition>(`/admin/surveys/${id}`);
    setEditing(survey);
  };

  if (isLoading) return <FullPageLoader />;

  return (
    <>
      <PageHeader
        title="Native surveys"
        subtitle="Surveys rendered directly inside the app. Contentful and third-party surveys are configured on the batch."
        actions={
          canManage ? (
            <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
              + New survey
            </button>
          ) : null
        }
      />

      {!data || data.length === 0 ? (
        <EmptyState
          title="No surveys yet"
          message="Create a native survey to attach it to a batch of codes."
          action={
            canManage ? (
              <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
                Create survey
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((survey) => (
            <div key={survey.id} className="card flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold text-slate-900">{survey.title}</p>
                <span
                  className={`badge ${
                    survey.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {survey.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              {survey.description ? (
                <p className="mt-1 line-clamp-2 text-sm text-slate-500">{survey.description}</p>
              ) : null}
              <p className="mt-3 text-xs text-slate-400">
                {survey.questionCount} questions · updated {formatDate(survey.updatedAt)}
              </p>
              {survey.forwardTarget && survey.forwardTarget !== 'NONE' ? (
                <p className="mt-1 text-xs text-brand-700">
                  ↻ Forwarding to {survey.forwardTarget === 'RUDDERSTACK' ? 'RudderStack' : 'a webhook'}
                  {survey.retainResponses === false ? ' · no local storage' : ''}
                </p>
              ) : null}
              <button
                type="button"
                className="btn-secondary mt-4"
                onClick={() => void openEditor(survey.id)}
              >
                {canManage ? 'Edit' : 'View'}
              </button>
            </div>
          ))}
        </div>
      )}

      {editing ? (
        <SurveyEditor
          survey={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: ['admin', 'surveys'] });
            setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}

function SurveyEditor({
  survey,
  onClose,
  onSaved,
}: {
  survey: SurveyDefinition | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(survey?.title ?? '');
  const [description, setDescription] = useState(survey?.description ?? '');
  const [isActive, setIsActive] = useState(survey?.isActive ?? true);
  const [forwardTarget, setForwardTarget] = useState<ForwardTarget>(survey?.forwardTarget ?? 'NONE');
  const [forwardUrl, setForwardUrl] = useState(survey?.forwardUrl ?? '');
  const [forwardSecret, setForwardSecret] = useState('');
  const [forwardEventName, setForwardEventName] = useState(
    survey?.forwardEventName ?? 'Survey Completed',
  );
  const [retainResponses, setRetainResponses] = useState(survey?.retainResponses ?? true);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [questions, setQuestions] = useState<SurveyQuestion[]>(
    survey?.questions?.length ? survey.questions : [emptyQuestion(0)],
  );
  const [error, setError] = useState<string | null>(null);

  const update = (index: number, patch: Partial<SurveyQuestion>) =>
    setQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)));

  const sendTest = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ ok: boolean; statusCode: number | null; error: string | null }>(
          `/admin/surveys/${survey?.id}/forwarding/test`,
        )
      ).data,
    onSuccess: (result) =>
      setTestResult(
        result.ok
          ? `Destination accepted the test event (HTTP ${result.statusCode}).`
          : `Failed: ${result.error ?? 'unknown error'}`,
      ),
    onError: (err) => setTestResult(`Failed: ${toApiError(err).message}`),
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        isActive,
        forwardTarget,
        forwardUrl: forwardTarget === 'NONE' ? undefined : forwardUrl.trim(),
        forwardSecret: forwardSecret.trim() || undefined,
        forwardEventName: forwardEventName.trim() || undefined,
        retainResponses,
        questions: questions.map((q, index) => ({
          id: q.id || `q${index + 1}`,
          type: q.type,
          label: q.label.trim(),
          helpText: q.helpText?.trim() || undefined,
          required: q.required ?? true,
          options: QUESTION_TYPES.find((t) => t.value === q.type)?.hasOptions ? q.options : undefined,
          min: q.type === 'nps' ? 0 : q.type === 'rating' ? 1 : undefined,
          max: q.type === 'nps' ? 10 : q.type === 'rating' ? 5 : undefined,
        })),
      };
      return survey
        ? (await api.patch(`/admin/surveys/${survey.id}`, payload)).data
        : (await api.post('/admin/surveys', payload)).data;
    },
    onSuccess: onSaved,
    onError: (err) => setError(toApiError(err).message),
  });

  return (
    <Modal open title={survey ? 'Edit survey' : 'New survey'} onClose={onClose} size="lg">
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          mutation.mutate();
        }}
      >
        <div>
          <label className="label" htmlFor="survey-title">
            Title
          </label>
          <input
            id="survey-title"
            className="input"
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="survey-description">
            Description <span className="text-slate-400">(optional)</span>
          </label>
          <input
            id="survey-description"
            className="input"
            value={description ?? ''}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-brand-600"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
          />
          Active
        </label>

        <div className="space-y-4">
          {questions.map((question, index) => {
            const typeMeta = QUESTION_TYPES.find((t) => t.value === question.type);
            return (
              <div key={index} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Question {index + 1}
                  </span>
                  {questions.length > 1 ? (
                    <button
                      type="button"
                      className="text-xs text-rose-600 hover:underline"
                      onClick={() => setQuestions((prev) => prev.filter((_, i) => i !== index))}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <label className="label">Label</label>
                    <input
                      className="input"
                      required
                      value={question.label}
                      onChange={(event) => update(index, { label: event.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label">Type</label>
                    <select
                      className="input"
                      value={question.type}
                      onChange={(event) => {
                        const nextType = event.target.value as SurveyQuestion['type'];
                        const meta = QUESTION_TYPES.find((t) => t.value === nextType);
                        update(index, {
                          type: nextType,
                          options: meta?.hasOptions
                            ? question.options ?? [{ value: 'yes', label: 'Yes' }]
                            : undefined,
                        });
                      }}
                    >
                      {QUESTION_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {typeMeta?.hasOptions ? (
                  <div className="mt-3">
                    <label className="label">Options</label>
                    <div className="space-y-2">
                      {(question.options ?? []).map((option, optionIndex) => (
                        <div key={optionIndex} className="flex gap-2">
                          <input
                            className="input"
                            placeholder="Label shown to the user"
                            value={option.label}
                            onChange={(event) =>
                              update(index, {
                                options: (question.options ?? []).map((o, i) =>
                                  i === optionIndex
                                    ? {
                                        label: event.target.value,
                                        value:
                                          event.target.value
                                            .toLowerCase()
                                            .replace(/[^a-z0-9]+/g, '_')
                                            .replace(/^_|_$/g, '') || `option_${optionIndex + 1}`,
                                      }
                                    : o,
                                ),
                              })
                            }
                          />
                          <button
                            type="button"
                            className="btn-ghost px-3"
                            onClick={() =>
                              update(index, {
                                options: (question.options ?? []).filter((_, i) => i !== optionIndex),
                              })
                            }
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="mt-2 text-xs font-medium text-brand-700 hover:underline"
                      onClick={() =>
                        update(index, {
                          options: [
                            ...(question.options ?? []),
                            { value: `option_${(question.options?.length ?? 0) + 1}`, label: '' },
                          ],
                        })
                      }
                    >
                      + Add option
                    </button>
                  </div>
                ) : null}

                <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-brand-600"
                    checked={question.required ?? true}
                    onChange={(event) => update(index, { required: event.target.checked })}
                  />
                  Required
                </label>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          className="btn-secondary w-full"
          onClick={() => setQuestions((prev) => [...prev, emptyQuestion(prev.length)])}
        >
          + Add question
        </button>

        <fieldset className="rounded-2xl border border-slate-200 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Forward responses
          </legend>
          <p className="text-xs text-slate-500">
            Each completed response is queued and pushed to your system. Deliveries are retried until
            they are acknowledged — track them under Deliveries. Payloads never include an e-mail
            address; consumers are identified by a one-way hash.
          </p>

          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {(
              [
                { value: 'NONE', label: 'Off', hint: 'Keep responses here only' },
                { value: 'WEBHOOK', label: 'Webhook', hint: 'Signed HTTPS POST' },
                { value: 'RUDDERSTACK', label: 'RudderStack', hint: 'track event' },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setForwardTarget(option.value)}
                className={`rounded-xl border px-3 py-2.5 text-left transition ${
                  forwardTarget === option.value
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <span className="block text-sm font-medium text-slate-800">{option.label}</span>
                <span className="block text-xs text-slate-500">{option.hint}</span>
              </button>
            ))}
          </div>

          {forwardTarget !== 'NONE' ? (
            <div className="mt-4 space-y-3">
              <div>
                <label className="label" htmlFor="survey-forward-url">
                  {forwardTarget === 'RUDDERSTACK' ? 'Data plane URL' : 'Endpoint URL'}
                </label>
                <input
                  id="survey-forward-url"
                  className="input"
                  required
                  placeholder={
                    forwardTarget === 'RUDDERSTACK'
                      ? 'https://your-org.dataplane.rudderstack.com'
                      : 'https://api.example.com/hooks/survey'
                  }
                  value={forwardUrl ?? ''}
                  onChange={(event) => setForwardUrl(event.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="survey-forward-secret">
                  {forwardTarget === 'RUDDERSTACK' ? 'Write key' : 'Signing secret'}{' '}
                  {survey?.forwardSecretSet ? (
                    <span className="text-slate-400">(stored — leave blank to keep)</span>
                  ) : null}
                </label>
                <input
                  id="survey-forward-secret"
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={forwardSecret}
                  onChange={(event) => setForwardSecret(event.target.value)}
                />
                <p className="mt-1 text-xs text-slate-500">
                  {forwardTarget === 'RUDDERSTACK'
                    ? 'Sent as HTTP basic auth, encrypted at rest.'
                    : 'Used for the X-Webhook-Signature HMAC so you can verify the sender.'}
                </p>
              </div>
              <div>
                <label className="label" htmlFor="survey-forward-event">
                  Event name
                </label>
                <input
                  id="survey-forward-event"
                  className="input"
                  value={forwardEventName}
                  onChange={(event) => setForwardEventName(event.target.value)}
                />
              </div>

              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600"
                  checked={!retainResponses}
                  onChange={(event) => setRetainResponses(!event.target.checked)}
                />
                <span>
                  Do not store responses in this system
                  <span className="block text-xs text-slate-500">
                    Answers and e-mail addresses are dropped after the event is queued. The queued
                    event becomes the system of record.
                  </span>
                </span>
              </label>

              {survey ? (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={sendTest.isPending}
                    onClick={() => {
                      setTestResult(null);
                      sendTest.mutate();
                    }}
                  >
                    {sendTest.isPending ? <Spinner /> : null}
                    Send test event
                  </button>
                  {testResult ? <span className="text-xs text-slate-600">{testResult}</span> : null}
                </div>
              ) : (
                <p className="text-xs text-slate-500">Save the survey to send a test event.</p>
              )}
            </div>
          ) : null}
        </fieldset>

        {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? <Spinner /> : null}
            Save survey
          </button>
        </div>
      </form>
    </Modal>
  );
}
