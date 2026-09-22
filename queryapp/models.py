from django.db import models


class Department(models.Model):
    name = models.CharField(max_length=100, unique=True)

    class Meta:
        db_table = 'departments'

    def __str__(self):
        return self.name


class Employee(models.Model):
    name = models.CharField(max_length=150)
    department = models.ForeignKey(
        Department,
        on_delete=models.CASCADE,
        related_name='employees'
    )

    class Meta:
        db_table = 'employees'

    def __str__(self):
        return self.name


class Salary(models.Model):
    employee = models.ForeignKey(
        Employee,
        on_delete=models.CASCADE,
        related_name='salaries'
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    effective_date = models.DateField()

    class Meta:
        db_table = 'salaries'

    def __str__(self):
        return f"{self.employee.name} — {self.amount}"


class QueryLog(models.Model):
    """
    One row per voice query attempt. Lets us show 'how the query ran'
    in the UI and gives us data for the evaluation section later.
    """
    raw_transcript = models.TextField()
    normalized_transcript = models.CharField(
        max_length=64, editable=False, db_index=True, default=""
    )
    generated_sql = models.TextField()
    was_confirmed = models.BooleanField(default=False)
    correction_text = models.TextField(blank=True, null=True)  # filled only if user said "no"
    row_count = models.IntegerField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self.normalized_transcript:
            self.normalized_transcript = self.normalize(self.raw_transcript)
        super().save(*args, **kwargs)

    @staticmethod
    def normalize(transcript: str) -> str:
        import hashlib
        return hashlib.sha256(transcript.strip().lower().encode("utf-8")).hexdigest()

    @staticmethod
    def normalize(transcript: str) -> str:
        import hashlib
        return hashlib.sha256(transcript.strip().lower().encode("utf-8")).hexdigest()

    def __str__(self):
        return f"[{self.created_at:%Y-%m-%d %H:%M}] {self.raw_transcript[:50]}"

    class Meta:
        ordering = ['-created_at']