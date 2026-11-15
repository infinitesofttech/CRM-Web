from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

KIND_CHOICES = [('lead', 'Lead'), ('intern', 'Internship'), ('expo', 'Expo')]

KINDS = {
    'lead': {
        'slug': 'leads', 'title': 'Leads (Clients)', 'singular': 'Lead',
        'statuses': ['New', 'Contacted', 'Interested', 'Follow-up', 'Proposal Sent', 'Won', 'Lost'],
    },
    'intern': {
        'slug': 'internships', 'title': 'Internship (Students)', 'singular': 'Student',
        'statuses': ['New', 'Called', 'No Answer', 'Interested', 'Follow-up', 'Wrong Number',
                     'Selected', 'Joined', 'Not Interested'],
    },
    'expo': {
        'slug': 'expo', 'title': 'Expo Clients', 'singular': 'Expo Client',
        'statuses': ['New', 'Called', 'Interested', 'Follow-up', 'Meeting Booked', 'Won', 'Not Interested'],
    },
}
SLUG_TO_KIND = {v['slug']: k for k, v in KINDS.items()}
CALL_OUTCOMES = ['Connected', 'No Answer', 'Busy', 'Switched Off', 'Wrong Number', 'Call Back Later']
CLOSED = ['Won', 'Lost', 'Joined', 'Not Interested', 'Selected', 'Wrong Number']


class Contact(models.Model):
    kind = models.CharField(max_length=10, choices=KIND_CHOICES)
    name = models.CharField(max_length=120, blank=True, default='')
    company = models.CharField(max_length=160, blank=True, default='')
    phone = models.CharField(max_length=20, blank=True, default='')
    email = models.CharField(max_length=160, blank=True, default='')
    website = models.CharField(max_length=200, blank=True, default='')
    college_name = models.CharField(max_length=120, blank=True, default='')
    source = models.CharField(max_length=80, blank=True, default='')
    status = models.CharField(max_length=30, default='New')
    assigned_to = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                    on_delete=models.SET_NULL, related_name='crm_contacts')
    notes = models.TextField(blank=True, default='')
    follow_up = models.DateField(null=True, blank=True)
    call_count = models.PositiveIntegerField(default=0)
    last_call_at = models.DateTimeField(null=True, blank=True)
    ext_ref = models.CharField(max_length=60, null=True, blank=True, unique=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['kind', 'status']),
            models.Index(fields=['kind', 'assigned_to']),
        ]
        constraints = [
            models.UniqueConstraint(fields=['kind', 'phone'], condition=~Q(phone=''),
                                    name='crm_unique_phone_per_kind'),
        ]
        ordering = ['-created_at', '-id']

    def __str__(self):
        return f'{self.name or self.company or "Contact"} {self.phone}'


class CallLog(models.Model):
    contact = models.ForeignKey(Contact, on_delete=models.CASCADE, related_name='calls')
    by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    by_name = models.CharField(max_length=120, blank=True, default='')
    outcome = models.CharField(max_length=30)
    note = models.CharField(max_length=1000, blank=True, default='')
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ['-created_at']
