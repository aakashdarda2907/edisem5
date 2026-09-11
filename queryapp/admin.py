from django.contrib import admin
from .models import Department, Employee, Salary, QueryLog


@admin.register(Department)
class DepartmentAdmin(admin.ModelAdmin):
    list_display = ['name']
    search_fields = ['name']


@admin.register(Employee)
class EmployeeAdmin(admin.ModelAdmin):
    list_display = ['name', 'department']
    list_filter = ['department']
    search_fields = ['name']


@admin.register(Salary)
class SalaryAdmin(admin.ModelAdmin):
    list_display = ['employee', 'amount', 'effective_date']
    list_filter = ['effective_date']
    ordering = ['-amount']


@admin.register(QueryLog)
class QueryLogAdmin(admin.ModelAdmin):
    list_display = ['raw_transcript', 'was_confirmed', 'row_count', 'created_at']
    list_filter = ['was_confirmed', 'created_at']
    readonly_fields = ['created_at']