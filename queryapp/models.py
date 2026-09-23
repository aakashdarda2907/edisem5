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
    One row per voice query attempt.
    Stores query information and execution time so we can
    display response-time statistics in the UI.
    """
    raw_transcript = models.TextField()
    generated_sql = models.TextField()
    was_confirmed = models.BooleanField(default=False)
    correction_text = models.TextField(blank=True, null=True)
    row_count = models.IntegerField(blank=True, null=True)

    # Task 2: database query execution time in milliseconds
    response_time_ms = models.FloatField(blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"[{self.created_at:%Y-%m-%d %H:%M}] {self.raw_transcript[:50]}"

    class Meta:
        ordering = ['-created_at']


class APIUsage(models.Model):
    date = models.DateField(unique=True)
    count = models.PositiveIntegerField(default=0)

    def __str__(self):
        return f"{self.date}: {self.count} Gemini calls"