from django.core.management.base import BaseCommand
from queryapp.models import Department, Employee, Salary


class Command(BaseCommand):
    help = "Seeds the database with sample departments, employees, and salaries."

    def handle(self, *args, **kwargs):
        Salary.objects.all().delete()
        Employee.objects.all().delete()
        Department.objects.all().delete()

        departments = {
            name: Department.objects.create(name=name)
            for name in ["Engineering", "Sales", "Marketing", "HR"]
        }

        employees_data = [
            ("Priya Menon", "Engineering", 1820000),
            ("Rohan Patil", "Engineering", 1740000),
            ("Aditi Shah", "Engineering", 1695000),
            ("Karan Verma", "Engineering", 1610000),
            ("Neha Joshi", "Engineering", 1580000),
            ("Sameer Iyer", "Sales", 1460000),
            ("Divya Nair", "Sales", 1390000),
            ("Farhan Sheikh", "Sales", 1325000),
            ("Ritu Kapoor", "Sales", 1280000),
            ("Om Desai", "Sales", 1215000),
            ("Ananya Rao", "Marketing", 980000),
            ("Vikram Malhotra", "Marketing", 875000),
            ("Sneha Kulkarni", "HR", 720000),
            ("Arjun Bhatt", "HR", 690000),
        ]

        for name, dept_name, salary_amount in employees_data:
            emp = Employee.objects.create(name=name, department=departments[dept_name])
            Salary.objects.create(
                employee=emp,
                amount=salary_amount,
                effective_date="2026-04-01",
            )

        self.stdout.write(self.style.SUCCESS(
            f"Seeded {Department.objects.count()} departments, "
            f"{Employee.objects.count()} employees, "
            f"{Salary.objects.count()} salary records."
        ))